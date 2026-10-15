import { describe, expect, it, vi } from 'vitest';

import { NodeRetryExhaustedError } from '../../errors';
import { withRetry } from '../../policies/RetryPolicy';

describe('withRetry', () => {
  it('should return result and retryCount 0 on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const { result, retryCount } = await withRetry(fn, { maxRetries: 3, delayMs: 1 }, 'testNode');
    expect(result).toBe('ok');
    expect(retryCount).toBe(0);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('should retry on error and succeed after transient failure', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))
      .mockResolvedValue('ok');

    const { result, retryCount } = await withRetry(fn, { maxRetries: 3, delayMs: 1 }, 'testNode');
    expect(result).toBe('ok');
    expect(retryCount).toBe(2);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw NodeRetryExhaustedError when all retries fail', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always-fail'));

    try {
      await withRetry(fn, { maxRetries: 2, delayMs: 1 }, 'failNode');
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NodeRetryExhaustedError);
      const err = e as NodeRetryExhaustedError;
      expect(err.nodeName).toBe('failNode');
      expect(err.maxRetries).toBe(2);
      expect(err.lastError.message).toBe('always-fail');
    }

    // initial attempt + 2 retries = 3 calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should respect retryOn filter — matching error retried', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValue('ok');

    const { result } = await withRetry(
      fn,
      { maxRetries: 2, delayMs: 1, retryOn: (e) => e.message === 'transient' },
      'node'
    );
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should respect retryOn filter — non-matching error propagates immediately', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fatal'));

    await expect(
      withRetry(fn, { maxRetries: 3, delayMs: 1, retryOn: (e) => e.message === 'transient' }, 'node')
    ).rejects.toThrow('fatal');

    // Only initial attempt, no retries
    expect(fn).toHaveBeenCalledOnce();
  });

  it('should apply exponential backoff delay', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    const start = Date.now();
    await withRetry(fn, { maxRetries: 3, delayMs: 50, backoffMultiplier: 2 }, 'node');
    const elapsed = Date.now() - start;

    // 50ms (attempt 0) + 100ms (attempt 1) = 150ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  it('should not retry once the signal is aborted', async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockImplementation(async () => {
      controller.abort();
      throw new Error('aborted');
    });

    await expect(
      withRetry(fn, { maxRetries: 3, delayMs: 1 }, 'testNode', undefined, controller.signal)
    ).rejects.toThrow('aborted');
    expect(fn).toHaveBeenCalledOnce();
  });
});
