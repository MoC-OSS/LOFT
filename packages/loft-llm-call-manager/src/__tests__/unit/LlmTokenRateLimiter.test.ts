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

    it('acquire takes the tokens and a request at once', async () => {
      vi.useFakeTimers();
      const limiter = new LlmTokenRateLimiter({ ...CONFIG, maxRequests: 2 });

      const first = track(limiter.acquire(600));
      const second = track(limiter.acquire(600));
      await vi.advanceTimersByTimeAsync(0);
      expect(first.done).toBe(true);
      expect(second.done).toBe(false);

      // The first call left 400 tokens, so the second one waits for 200 more
      await vi.advanceTimersByTimeAsync(199);
      expect(second.done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(second.done).toBe(true);

      // Both requests are spent: the next call waits for the request refill
      const third = track(limiter.acquire(1));
      await vi.advanceTimersByTimeAsync(0);
      expect(third.done).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect(third.done).toBe(true);
      limiter.stop();
    });

    it('acquire rechecks after waiting', async () => {
      vi.useFakeTimers();
      const limiter = new LlmTokenRateLimiter({ ...CONFIG, maxRequests: 2 });
      limiter.setUsedTokens(1000);

      const call = track(limiter.acquire(500));
      await vi.advanceTimersByTimeAsync(400);
      // Another caller spends 300 tokens while this one waits, so the refill it waited for is not enough
      limiter.setUsedTokens(300);
      await vi.advanceTimersByTimeAsync(399);
      expect(call.done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(call.done).toBe(true);
      limiter.stop();
    });

    it('acquire rejects once the waits add up to more than maxAwaitSeconds', async () => {
      vi.useFakeTimers();
      const limiter = new LlmTokenRateLimiter({ ...CONFIG, maxRequests: 2, maxAwaitSeconds: 1 });
      limiter.setUsedTokens(1000);

      const call = limiter.acquire(500);
      const rejected = expect(call).rejects.toBeInstanceOf(LlmCallManagerLongAwaitError);
      // The first wait of 500 ms fits; another caller then spends tokens, and the second wait would end past one second
      await vi.advanceTimersByTimeAsync(400);
      limiter.setUsedTokens(600);
      await vi.advanceTimersByTimeAsync(100);

      await rejected;
      limiter.stop();
    });

    it('acquire rejects a call that would wait longer than maxAwaitSeconds', async () => {
      vi.useFakeTimers();
      const limiter = new LlmTokenRateLimiter({ ...CONFIG, maxAwaitSeconds: 1 });
      limiter.setUsedTokens(2000);

      // From -1000 tokens, 500 are a 1.5-second wait
      await expect(limiter.acquire(500)).rejects.toBeInstanceOf(LlmCallManagerLongAwaitError);
      limiter.stop();
    });

    it('acquire lets an oversized request through once the bucket is full', async () => {
      vi.useFakeTimers();
      const limiter = new LlmTokenRateLimiter({ ...CONFIG, maxRequests: 2, maxAwaitSeconds: 1 });
      limiter.setUsedTokens(500);

      // 1500 tokens never fit in a 1000-token bucket, so the call waits only until the bucket is full again
      const call = track(limiter.acquire(1500));
      await vi.advanceTimersByTimeAsync(499);
      expect(call.done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(call.done).toBe(true);

      // It took all 1500 tokens: the budget is at -500, so 100 more tokens are 600 ms away
      const next = track(limiter.acquire(100));
      await vi.advanceTimersByTimeAsync(599);
      expect(next.done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(next.done).toBe(true);
      limiter.stop();
    });

    it('acquire ends at once when its signal aborts during the wait, and takes nothing', async () => {
      vi.useFakeTimers();
      const limiter = new LlmTokenRateLimiter({ ...CONFIG, maxRequests: 2 });
      limiter.setUsedTokens(1000);
      const controller = new AbortController();
      const reason = new Error('client went away');

      const call = limiter.acquire(500, controller.signal);
      const rejected = expect(call).rejects.toBe(reason);
      await vi.advanceTimersByTimeAsync(100);
      controller.abort(reason);
      await rejected;

      // The wait timer is cleared, and only the refill timer is left
      expect(vi.getTimerCount()).toBe(1);
      // Nothing was taken: the budget is full again after one second, and a call for all of it does not wait
      await vi.advanceTimersByTimeAsync(900);
      const next = track(limiter.acquire(1000));
      await vi.advanceTimersByTimeAsync(0);
      expect(next.done).toBe(true);
      limiter.stop();
    });

    it('acquire leaves no abort listener behind after a wait', async () => {
      vi.useFakeTimers();
      const limiter = new LlmTokenRateLimiter({ ...CONFIG, maxRequests: 2 });
      limiter.setUsedTokens(1000);
      const controller = new AbortController();
      const addListener = vi.spyOn(controller.signal, 'addEventListener');
      const removeListener = vi.spyOn(controller.signal, 'removeEventListener');

      const call = track(limiter.acquire(500, controller.signal));
      await vi.advanceTimersByTimeAsync(500);

      expect(call.done).toBe(true);
      expect(addListener).toHaveBeenCalledTimes(1);
      expect(removeListener).toHaveBeenCalledWith('abort', addListener.mock.calls[0][1]);
      limiter.stop();
    });

    it('acquire rejects with the reason of a signal aborted before the call, even with budget left', async () => {
      // One request and no waiting: a call that finds the request taken fails at once
      const limiter = new LlmTokenRateLimiter({ ...CONFIG, maxAwaitSeconds: 0 });
      const reason = new Error('client went away');

      await expect(limiter.acquire(1, AbortSignal.abort(reason))).rejects.toBe(reason);
      // The request was not taken, so the next call gets it without a wait
      await expect(limiter.acquire(1)).resolves.toBeUndefined();
      await expect(limiter.acquire(1)).rejects.toBeInstanceOf(LlmCallManagerLongAwaitError);
      limiter.stop();
    });

    it('settle refund is capped at maxTokens', async () => {
      vi.useFakeTimers();
      const limiter = new LlmTokenRateLimiter({ ...CONFIG, maxRequests: 2 });

      // A refund on a full bucket does not raise it above 1000 tokens
      limiter.setUsedTokens(-500);
      await limiter.acquire(1000);
      const next = track(limiter.acquire(500));
      await vi.advanceTimersByTimeAsync(499);
      expect(next.done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(next.done).toBe(true);
      limiter.stop();
    });
  });
});
