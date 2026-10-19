/**
 * The retry policy of the call managers: retry only what can succeed on a new attempt (408, 429, 5xx and network
 * failures), with exponential backoff and jitter, and wait as long as the provider's `Retry-After` asks.
 */

// Connection failures from Node.js, undici (fetch) and axios
const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT'
]);

// The connection errors of the OpenAI and Anthropic SDKs, which carry no status
const NETWORK_ERROR_NAMES = new Set(['APIConnectionError', 'APIConnectionTimeoutError']);

const DEFAULT_MAX_DELAY_MS = 60_000;

type ErrorLike = {
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  name?: unknown;
  message?: unknown;
  headers?: unknown;
  response?: { status?: unknown; headers?: unknown };
  cause?: unknown;
};

// The error and its causes, as provider errors are sometimes wrapped
function errorChain(error: unknown): ErrorLike[] {
  const chain: ErrorLike[] = [];
  let current = error;
  while (current && typeof current === 'object' && chain.length < 5) {
    chain.push(current as ErrorLike);
    current = (current as ErrorLike).cause;
  }
  return chain;
}

/** The HTTP status of a provider SDK error (`status`), an axios error (`response.status`) or one of their causes */
export function errorStatus(error: unknown): number | undefined {
  for (const item of errorChain(error)) {
    for (const status of [item.status, item.statusCode, item.response?.status]) {
      if (typeof status === 'number') return status;
    }
  }
  return undefined;
}

function isNetworkError(error: unknown): boolean {
  return errorChain(error).some(
    (item) =>
      (typeof item.code === 'string' && NETWORK_ERROR_CODES.has(item.code)) ||
      (typeof item.name === 'string' && NETWORK_ERROR_NAMES.has(item.name)) ||
      (item instanceof TypeError && item.message === 'fetch failed')
  );
}

/** Whether a new attempt can succeed: 408, 429, 5xx and network failures. A 400, 401 or 404 cannot. */
export function isRetryableError(error: unknown): boolean {
  const status = errorStatus(error);
  if (status !== undefined) return status === 408 || status === 429 || status >= 500;
  return isNetworkError(error);
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const value = (headers as { get(name: string): unknown }).get(name);
    if (value !== null && value !== undefined) return String(value);
  }
  const value = (headers as Record<string, unknown>)[name];
  return value === null || value === undefined ? undefined : String(value);
}

/** How long the provider asks to wait (`retry-after-ms`, or `retry-after` in seconds or as a date), in ms */
export function retryAfterMs(error: unknown, now = Date.now()): number | undefined {
  for (const item of errorChain(error)) {
    for (const headers of [item.headers, item.response?.headers]) {
      const retryAfterMilliseconds = readHeader(headers, 'retry-after-ms');
      if (retryAfterMilliseconds !== undefined) {
        const milliseconds = Number(retryAfterMilliseconds);
        if (Number.isFinite(milliseconds) && milliseconds >= 0) return milliseconds;
      }
      const retryAfter = readHeader(headers, 'retry-after');
      if (retryAfter === undefined) continue;
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
      const date = Date.parse(retryAfter);
      if (!Number.isNaN(date)) return Math.max(0, date - now);
    }
  }
  return undefined;
}

/**
 * The wait before retry number `attempt` (1 for the first retry): `Retry-After` when the provider sends it,
 * otherwise `baseDelayMs` doubled for each attempt, between half and all of it at random, at most `maxDelayMs`.
 */
export function retryDelayMs(
  error: unknown,
  attempt: number,
  baseDelayMs: number,
  maxDelayMs = DEFAULT_MAX_DELAY_MS
): number {
  const requested = retryAfterMs(error);
  if (requested !== undefined) return Math.min(requested, maxDelayMs);
  const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  return backoff / 2 + Math.random() * (backoff / 2);
}
