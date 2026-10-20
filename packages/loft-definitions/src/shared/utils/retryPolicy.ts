import { randomInt } from 'node:crypto';

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

// The connection errors of the OpenAI and Anthropic SDKs, which carry no status. Their instances keep the name
// 'Error', so these are matched against the class names along the prototype chain.
const NETWORK_ERROR_CLASSES = new Set(['APIConnectionError', 'APIConnectionTimeoutError']);

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

// The name of the error and the names of its classes, from the error's own class up to Error
function errorClassNames(item: ErrorLike): string[] {
  const names = typeof item.name === 'string' ? [item.name] : [];
  let prototype: unknown = Object.getPrototypeOf(item);
  while (prototype && prototype !== Error.prototype && prototype !== Object.prototype && names.length < 10) {
    const name = (prototype as { constructor?: { name?: unknown } }).constructor?.name;
    if (typeof name === 'string') names.push(name);
    prototype = Object.getPrototypeOf(prototype);
  }
  return names;
}

function isNetworkError(error: unknown): boolean {
  return errorChain(error).some(
    (item) =>
      (typeof item.code === 'string' && NETWORK_ERROR_CODES.has(item.code)) ||
      errorClassNames(item).some((name) => NETWORK_ERROR_CLASSES.has(name)) ||
      (item instanceof TypeError && item.message === 'fetch failed')
  );
}

/** Whether a new attempt can succeed: 408, 429, 5xx and network failures. A 400, 401 or 404 cannot. */
export function isRetryableError(error: unknown): boolean {
  const status = errorStatus(error);
  if (status !== undefined) return status === 408 || status === 429 || status >= 500;
  return isNetworkError(error);
}

function headerText(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const value = headerText((headers as { get(name: string): unknown }).get(name));
    if (value !== undefined) return value;
  }
  return headerText((headers as Record<string, unknown>)[name]);
}

function nonNegativeNumber(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

// The wait one set of response headers asks for, in ms
function requestedWaitMs(headers: unknown, now: number): number | undefined {
  const milliseconds = nonNegativeNumber(readHeader(headers, 'retry-after-ms'));
  if (milliseconds !== undefined) return milliseconds;
  const retryAfter = readHeader(headers, 'retry-after');
  if (retryAfter === undefined) return undefined;
  const seconds = nonNegativeNumber(retryAfter);
  if (seconds !== undefined) return seconds * 1000;
  const date = Date.parse(retryAfter);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** How long the provider asks to wait (`retry-after-ms`, or `retry-after` in seconds or as a date), in ms */
export function retryAfterMs(error: unknown, now = Date.now()): number | undefined {
  for (const item of errorChain(error)) {
    for (const headers of [item.headers, item.response?.headers]) {
      const wait = requestedWaitMs(headers, now);
      if (wait !== undefined) return wait;
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
  // A missing or invalid delay (NaN from an unset environment variable, say) must not replace the provider error
  const base = Number.isFinite(baseDelayMs) && baseDelayMs > 0 ? baseDelayMs : 0;
  const exponent = Number.isFinite(attempt) && attempt > 1 ? attempt - 1 : 0;
  const backoff = Math.floor(Math.min(base * 2 ** exponent, maxDelayMs));
  const half = Math.floor(backoff / 2);
  return half + randomInt(0, backoff - half + 1);
}

/** Waits `ms` before a retry, and rejects with the signal's reason as soon as `signal` aborts */
export function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
