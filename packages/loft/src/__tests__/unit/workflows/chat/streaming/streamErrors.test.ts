import { Chat, GenerateError, StreamIdleTimeoutError } from '@moc-global/loft-definitions';
import { describe, expect, it } from 'vitest';

import { toStreamError } from '../../../../../workflows/chat/streaming/streamErrors';

// Stand-ins for the call manager's errors, which are matched by the literal name they set
class TooManyHighPriorityTasksError extends Error {
  override readonly name = 'TooManyHighPriorityTasksError';
}
class LlmCallManagerLongAwaitError extends Error {
  override readonly name = 'LlmCallManagerLongAwaitError';
}

// Like an SDK's API error: no name of its own, and the HTTP status when there is one
class ApiError extends Error {
  constructor(
    readonly status: number | undefined,
    readonly error: unknown,
    message: string
  ) {
    super(message);
  }
}

function wrapped(cause: unknown): GenerateError {
  return new GenerateError('session-1', [], [], Chat.Status.ERROR, 'generate failed', cause);
}

describe('toStreamError', () => {
  it('toStreamError maps idle timeout and queue errors by name, 429 and 5xx by status, a status-less SDK error with an own error property, a cause wrapped in GenerateError, unknown', () => {
    expect(toStreamError(new StreamIdleTimeoutError(1000))).toEqual({
      code: 'timeout',
      message: 'The response took too long.',
      retryable: true
    });
    expect(toStreamError(new TooManyHighPriorityTasksError('queue full'))).toEqual({
      code: 'rate_limited',
      message: 'Too many requests. Try again shortly.',
      retryable: true
    });
    expect(toStreamError(new LlmCallManagerLongAwaitError('waited'))).toMatchObject({ code: 'rate_limited' });

    expect(toStreamError(new ApiError(429, { type: 'rate_limit' }, 'slow down'))).toMatchObject({
      code: 'rate_limited',
      retryable: true
    });
    expect(toStreamError(new ApiError(503, undefined, 'unavailable'))).toEqual({
      code: 'provider_error',
      message: 'The model provider returned an error.',
      retryable: true
    });
    expect(toStreamError(Object.assign(new Error('axios'), { response: { status: 502 } }))).toMatchObject({
      code: 'provider_error'
    });

    // An error raised inside a stream: no status, the event body as `error`
    expect(toStreamError(new ApiError(undefined, { type: 'invalid_request_error' }, 'bad chunk'))).toEqual({
      code: 'provider_error',
      message: 'The model provider returned an error.',
      retryable: false
    });
    expect(toStreamError(Object.assign(new Error('no body'), { headers: {} }))).toMatchObject({
      code: 'provider_error'
    });

    expect(toStreamError(wrapped(new ApiError(429, undefined, 'limited')))).toMatchObject({ code: 'rate_limited' });
    expect(toStreamError(wrapped(wrapped(new StreamIdleTimeoutError())))).toMatchObject({ code: 'timeout' });

    expect(toStreamError(new Error('rate limit exceeded: 429 timeout'))).toEqual({
      code: 'internal',
      message: 'Failed to generate a response.',
      retryable: false
    });
    expect(toStreamError('a string')).toMatchObject({ code: 'internal' });
    expect(toStreamError(undefined)).toMatchObject({ code: 'internal' });
    expect(toStreamError(wrapped(new TypeError('x is undefined')))).toMatchObject({ code: 'internal' });
  });

  it('retryable provider_error when the cause is retryable', () => {
    expect(toStreamError(new ApiError(500, undefined, 'server')).retryable).toBe(true);
    expect(toStreamError(new ApiError(408, undefined, 'timeout')).retryable).toBe(true);
    expect(toStreamError(new ApiError(400, undefined, 'bad request')).retryable).toBe(false);
    expect(toStreamError(new ApiError(401, undefined, 'auth')).retryable).toBe(false);
    expect(toStreamError(new ApiError(undefined, { type: 'overloaded_error' }, 'busy')).retryable).toBe(true);
    expect(toStreamError(wrapped(new ApiError(undefined, { type: 'api_error' }, 'oops'))).retryable).toBe(true);
  });

  it('a network failure without a status is a retryable provider_error, as the call manager retries it', () => {
    // What undici's fetch rejects with when the socket closes in the middle of a stream
    const socketError = Object.assign(new Error('other side closed'), { name: 'SocketError', code: 'UND_ERR_SOCKET' });
    const terminated = new TypeError('terminated', { cause: socketError });
    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

    const fetchFailed = new TypeError('fetch failed');

    for (const error of [terminated, reset, fetchFailed, wrapped(terminated), wrapped(reset)]) {
      expect(toStreamError(error)).toEqual({
        code: 'provider_error',
        message: 'The model provider returned an error.',
        retryable: true
      });
    }
    // An error the call manager does not retry stays internal
    expect(toStreamError(new TypeError('terminated'))).toMatchObject({ code: 'internal', retryable: false });
  });

  it('rate_limited carries retryAfterMs when the error or a cause has a retry-after header', () => {
    const limited = (headers: unknown) => Object.assign(new ApiError(429, undefined, 'slow down'), { headers });

    expect(toStreamError(limited({ 'retry-after': '20' }))).toEqual({
      code: 'rate_limited',
      message: 'Too many requests. Try again shortly.',
      retryable: true,
      retryAfterMs: 20_000
    });
    expect(toStreamError(limited(new Headers({ 'retry-after-ms': '1500.2' })))).toMatchObject({ retryAfterMs: 1501 });
    expect(toStreamError(wrapped(limited({ 'retry-after': '3' })))).toMatchObject({ retryAfterMs: 3000 });
    // An axios-style error keeps its headers on the response
    const axiosLike = Object.assign(new Error('limited'), {
      response: { status: 429, headers: { 'retry-after': '7' } }
    });
    expect(toStreamError(axiosLike)).toMatchObject({ code: 'rate_limited', retryAfterMs: 7000 });

    // No header, or one that is not a wait: no field at all
    expect(toStreamError(limited({}))).not.toHaveProperty('retryAfterMs');
    expect(toStreamError(limited({ 'retry-after': 'soon' }))).not.toHaveProperty('retryAfterMs');
    expect(toStreamError(new TooManyHighPriorityTasksError('queue full'))).not.toHaveProperty('retryAfterMs');
    // Only a rate limit says how long to wait
    const unavailable = Object.assign(new ApiError(503, undefined, 'busy'), { headers: { 'retry-after': '5' } });
    expect(toStreamError(unavailable)).not.toHaveProperty('retryAfterMs');
  });

  it('looks at the error and four causes, and stops at a cycle', () => {
    let deep: unknown = new ApiError(429, undefined, 'limited');
    for (let level = 0; level < 4; level++) deep = new Error('wrapper', { cause: deep });
    expect(toStreamError(deep).code).toBe('rate_limited');
    expect(toStreamError(new Error('one more', { cause: deep })).code).toBe('internal');

    const cyclic: Error & { cause?: unknown } = new Error('cyclic');
    cyclic.cause = cyclic;
    expect(toStreamError(cyclic).code).toBe('internal');
  });

  it('messages never include the cause text', () => {
    const errors = [
      new ApiError(500, { message: 'provider secret' }, 'provider secret'),
      wrapped(new Error('provider secret')),
      new StreamIdleTimeoutError(5)
    ];
    for (const error of errors) {
      expect(toStreamError(error).message).not.toContain('secret');
    }
  });
});
