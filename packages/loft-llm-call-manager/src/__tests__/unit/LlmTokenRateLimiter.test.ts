import { afterEach, describe, expect, it, vi } from 'vitest';

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
});
