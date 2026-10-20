import { describe, expect, it, vi } from 'vitest';

import { errorStatus, isRetryableError, retryAfterMs, retryDelayMs, waitForRetry } from '../..';

const withStatus = (status: number) => Object.assign(new Error(`status ${status}`), { status });

describe('retry policy', () => {
  it.each([408, 429, 500, 502, 503, 529])('retries a %i response', (status) => {
    expect(isRetryableError(withStatus(status))).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])('does not retry a %i response', (status) => {
    expect(isRetryableError(withStatus(status))).toBe(false);
  });

  it('reads the status of an axios error and of a wrapped error', () => {
    expect(errorStatus(Object.assign(new Error('axios'), { response: { status: 503 } }))).toBe(503);
    expect(errorStatus(new Error('wrapped', { cause: withStatus(429) }))).toBe(429);
    expect(errorStatus(new Error('plain'))).toBeUndefined();
  });

  it('retries network failures', () => {
    expect(isRetryableError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isRetryableError(Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' }))).toBe(true);
    expect(isRetryableError(new TypeError('fetch failed', { cause: { code: 'UND_ERR_SOCKET' } }))).toBe(true);
  });

  it('retries an error whose class, not its name, is a connection error', () => {
    // Like the SDKs: the class is APIConnectionTimeoutError, the name stays 'Error'
    class APIConnectionError extends Error {}
    class APIConnectionTimeoutError extends APIConnectionError {}

    expect(new APIConnectionTimeoutError('timed out').name).toBe('Error');
    expect(isRetryableError(new APIConnectionTimeoutError('timed out'))).toBe(true);
    expect(isRetryableError(new APIConnectionError('Connection error.'))).toBe(true);
  });

  it('does not retry other errors', () => {
    expect(isRetryableError(new TypeError('cannot read properties of undefined'))).toBe(false);
    expect(isRetryableError('a string')).toBe(false);
  });

  it('reads Retry-After from a Headers object, a plain object and an axios response', () => {
    expect(retryAfterMs({ headers: new Headers({ 'retry-after-ms': '1500' }) })).toBe(1500);
    expect(retryAfterMs({ headers: { 'retry-after': '3' } })).toBe(3000);
    expect(retryAfterMs({ response: { headers: { 'retry-after': '1' } } })).toBe(1000);
    const now = Date.parse('2026-10-19T12:00:00Z');
    expect(retryAfterMs({ headers: { 'retry-after': 'Mon, 19 Oct 2026 12:00:05 GMT' } }, now)).toBe(5000);
    expect(retryAfterMs({ headers: { 'retry-after': 'soon' } })).toBeUndefined();
    expect(retryAfterMs(new Error('no headers'))).toBeUndefined();
  });

  it('waits as long as Retry-After asks, up to the maximum', () => {
    expect(retryDelayMs({ headers: { 'retry-after': '2' } }, 1, 100)).toBe(2000);
    expect(retryDelayMs({ headers: { 'retry-after': '600' } }, 1, 100)).toBe(60_000);
  });

  it('doubles the delay for each attempt, between half and all of it', () => {
    for (const [attempt, low, high] of [
      [1, 500, 1000],
      [2, 1000, 2000],
      [3, 2000, 4000]
    ]) {
      for (let sample = 0; sample < 50; sample++) {
        const delay = retryDelayMs(new Error('x'), attempt, 1000);
        expect(delay).toBeGreaterThanOrEqual(low);
        expect(delay).toBeLessThanOrEqual(high);
      }
    }
    expect(retryDelayMs(new Error('x'), 20, 1000)).toBeGreaterThanOrEqual(30_000);
    expect(retryDelayMs(new Error('x'), 20, 1000)).toBeLessThanOrEqual(60_000);
    expect(retryDelayMs(new Error('x'), 1, 0)).toBe(0);
  });

  it('ignores a retryDelay that is not a number instead of throwing', () => {
    expect(retryDelayMs(new Error('x'), 1, Number.NaN)).toBe(0);
    expect(retryDelayMs(new Error('x'), 1, undefined as unknown as number)).toBe(0);
    expect(retryDelayMs(new Error('x'), 1, -100)).toBe(0);
  });

  it('ends the wait before a retry when the signal aborts', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const wait = waitForRetry(60_000, controller.signal);
      controller.abort(new Error('client went away'));

      await expect(wait).rejects.toThrow('client went away');
      expect(vi.getTimerCount()).toBe(0);
      await expect(waitForRetry(10, controller.signal)).rejects.toThrow('client went away');
    } finally {
      vi.useRealTimers();
    }
  });
});
