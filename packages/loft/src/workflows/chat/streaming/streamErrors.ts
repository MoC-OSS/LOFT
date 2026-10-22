import { Chat, isRetryableError, retryAfterMs } from '@moc-global/loft-definitions';

export interface StreamError {
  code: Chat.ChatStreamErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

// The text a caller sees for each code. Fixed, so a provider's error text never reaches the caller.
const MESSAGES: Record<Chat.ChatStreamErrorCode, string> = {
  provider_error: 'The model provider returned an error.',
  rate_limited: 'Too many requests. Try again shortly.',
  timeout: 'The response took too long.',
  internal: 'Failed to generate a response.'
};

// LOFT's own errors, matched by the literal name they set (the call manager's classes are not imported here)
const TIMEOUT_ERROR_NAMES = new Set(['StreamIdleTimeoutError']);
const RATE_LIMIT_ERROR_NAMES = new Set(['TooManyHighPriorityTasksError', 'LlmCallManagerLongAwaitError']);

// How many errors of the cause chain are looked at: the error itself and its causes
const MAX_CHAIN_LENGTH = 5;

type ErrorLike = {
  name?: unknown;
  status?: unknown;
  statusCode?: unknown;
  response?: { status?: unknown };
  cause?: unknown;
};

// The error and its causes, as LOFT wraps errors (GenerateError) and so do some SDKs
function errorChain(error: unknown): ErrorLike[] {
  const chain: ErrorLike[] = [];
  let current = error;
  while (current && typeof current === 'object' && chain.length < MAX_CHAIN_LENGTH && !chain.includes(current)) {
    chain.push(current);
    current = (current as ErrorLike).cause;
  }
  return chain;
}

// The HTTP status of one error of the chain (not of its causes); a non-numeric status (ChatError's) is not one
function httpStatus(item: ErrorLike): number | undefined {
  for (const status of [item.status, item.statusCode, item.response?.status]) {
    if (typeof status === 'number') return status;
  }
  return undefined;
}

function streamError(code: Chat.ChatStreamErrorCode, retryable: boolean): StreamError {
  return { code, message: MESSAGES[code], retryable };
}

// A rate limit, with the wait the provider asked for when an error of the chain carries a retry-after header
function rateLimited(error: unknown): StreamError {
  const wait = retryAfterMs(error);
  return { ...streamError('rate_limited', true), ...(wait !== undefined && { retryAfterMs: Math.ceil(wait) }) };
}

/**
 * The `error` event for a failed generation: a fixed message per code, chosen by the error's structure and never by
 * its message. The first error of the cause chain that is recognised decides the code. A rate limit carries
 * `retryAfterMs` when the provider asked for a wait.
 */
export function toStreamError(error: unknown): StreamError {
  for (const item of errorChain(error)) {
    if (typeof item.name === 'string' && TIMEOUT_ERROR_NAMES.has(item.name)) return streamError('timeout', true);
    if (typeof item.name === 'string' && RATE_LIMIT_ERROR_NAMES.has(item.name)) return rateLimited(error);

    const status = httpStatus(item);
    if (status === 429) return rateLimited(error);
    // An SDK error raised mid-stream carries no status, but has its own `error` (the event body) or `headers`
    if (status !== undefined || Object.hasOwn(item, 'error') || Object.hasOwn(item, 'headers')) {
      return streamError('provider_error', isRetryableError(item));
    }
  }
  // A network failure, such as a reset connection, carries no status either, and the call manager retries it
  if (isRetryableError(error)) return streamError('provider_error', true);
  return streamError('internal', false);
}
