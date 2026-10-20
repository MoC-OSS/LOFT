import { afterEach, describe, expect, it, vi } from 'vitest';

import { LlmCallManagerLongAwaitError } from '../../errors';
import { LlmTokenRateLimiter } from '../../LlmTokenRateLimiter';

const CONFIG = {
  newTokensPerSecond: 1000,
  newRequestsPerSecond: 1,
  maxTokens: 1000,
  maxRequests: 1,
  maxAwaitSeconds: 5
};

describe('LlmTokenRateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not keep the process alive with its refill timer', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const limiter = new LlmTokenRateLimiter(CONFIG);

    const timer = setIntervalSpy.mock.results[0].value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(false);
    limiter.stop();
  });

  it('clears the refill timer on stop()', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const limiter = new LlmTokenRateLimiter(CONFIG);

    limiter.stop();

    expect(clearIntervalSpy).toHaveBeenCalledWith(setIntervalSpy.mock.results[0].value);
  });

  it('refills requests every second until stopped', async () => {
    vi.useFakeTimers();
    const limiter = new LlmTokenRateLimiter(CONFIG);
    limiter.setUsedRequest();

    // The refill restores the request, so the call does not wait
    await vi.advanceTimersByTimeAsync(1000);
    await expect(Promise.race([limiter.awaitBeforeCall(), Promise.resolve('waiting')])).resolves.toBeUndefined();

    limiter.stop();
    limiter.setUsedRequest();
    await vi.advanceTimersByTimeAsync(5000);

    // No refill after stop(), so the call has to wait
    await expect(Promise.race([limiter.awaitBeforeCall(), Promise.resolve('waiting')])).resolves.toBe('waiting');
  });

  describe('with fake timers', () => {
    // Whether the call has finished waiting; read it after advancing the timers
    function track(call: Promise<void>) {
      const state = { done: false };
      void call.then(() => (state.done = true));
      return state;
    }

    it('lets a call through at once while tokens and requests are left', async () => {
      vi.useFakeTimers();
      const limiter = new LlmTokenRateLimiter({ ...CONFIG, maxRequests: 2 });

      const call = track(limiter.awaitBeforeCall(500));
      await vi.advanceTimersByTimeAsync(0);

      expect(call.done).toBe(true);
      limiter.stop();
    });

    it('waits until enough tokens refill', async () => {
      vi.useFakeTimers();
      const limiter = new LlmTokenRateLimiter({ ...CONFIG, maxRequests: 2 });
      limiter.setUsedTokens(1000);

      const call = track(limiter.awaitBeforeCall(500));
      await vi.advanceTimersByTimeAsync(499);
      expect(call.done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(call.done).toBe(true);
      limiter.stop();
    });

    it('waits for the next request refill when no request is left', async () => {
      vi.useFakeTimers();
      const limiter = new LlmTokenRateLimiter(CONFIG);
      limiter.setUsedRequest();

      const call = track(limiter.awaitBeforeCall());
      await vi.advanceTimersByTimeAsync(999);
      expect(call.done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(call.done).toBe(true);
      limiter.stop();
    });

    it('rejects a call that would wait longer than maxAwaitSeconds', async () => {
      vi.useFakeTimers();
      const limiter = new LlmTokenRateLimiter({ ...CONFIG, maxAwaitSeconds: 1 });
      limiter.setUsedTokens(1000);

      // 5000 tokens at 1000 per second is a five-second wait
      await expect(limiter.awaitBeforeCall(5000)).rejects.toBeInstanceOf(LlmCallManagerLongAwaitError);
      limiter.stop();
    });

    it('never holds more tokens than maxTokens', async () => {
      vi.useFakeTimers();
      const limiter = new LlmTokenRateLimiter({ ...CONFIG, maxRequests: 2, maxAwaitSeconds: 1 });

      await vi.advanceTimersByTimeAsync(60_000);

      // A full minute of refill would cover it, but the bucket stops at 1000 tokens: 1500 more take 1.5 s
      await expect(limiter.awaitBeforeCall(2500)).rejects.toBeInstanceOf(LlmCallManagerLongAwaitError);
      limiter.stop();
    });
  });
});
