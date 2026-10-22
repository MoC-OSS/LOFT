import { Interface, Logger, Strategy } from '@moc-global/loft-definitions';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { LlmCallManagerLongAwaitError, TooManyHighPriorityTasksError } from '../../errors';
import { GenerateCallManager } from '../../GenerateManager';
import { LlmTokenRateLimiter } from '../../LlmTokenRateLimiter';
import { GenerateConfig } from '../../types';

type Body = { messages: string[] };

const BODY: Body = { messages: ['hello'] };
const REQUEST: Strategy.LLM.LLMRequest<Body> = {
  sessionId: 'session-1',
  requestType: Strategy.LLM.LLMRequestType.GENERATE,
  llmName: 'fake',
  llmBody: BODY,
  priority: 30
};
const CONFIG: GenerateConfig = { highPriorityTasksLimit: 10, retryDelay: 0, retryAttemptsLimit: 3 };

describe('GenerateCallManager', () => {
  const generate = vi.fn<(llmRequest: Body, options?: Strategy.LLM.CallOptions) => Promise<unknown>>();
  const awaitBeforeCall = vi.fn<(requestedTokens?: number) => Promise<void>>();
  let manager: GenerateCallManager<Body, unknown>;

  beforeAll(() => {
    Logger.configure({ logLevel: Interface.LogLevel.NONE });
  });

  beforeEach(() => {
    generate.mockReset();
    awaitBeforeCall.mockReset().mockResolvedValue(undefined);
    const llmApi = {
      generate,
      reduceMessages: () => 'hello',
      extractUsedTokens: () => 1,
      tokenRateLimiter: { awaitBeforeCall, setUsedTokens: vi.fn(), setUsedRequest: vi.fn() },
      llmTokenizer: { calculateTokensFromString: () => 1 }
    } as unknown as Strategy.LLM.LLMApi;
    manager = new GenerateCallManager('test', CONFIG, llmApi);
  });

  describe('abort signal', () => {
    it('passes the signal to llmStrategy.generate', async () => {
      const { signal } = new AbortController();
      generate.mockResolvedValue('response');

      await expect(manager.addHighPriorityTask(REQUEST, { signal })).resolves.toBe('response');

      expect(generate).toHaveBeenCalledWith(BODY, { signal });
    });

    it('rejects an already-aborted call without calling generate', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(manager.addHighPriorityTask(REQUEST, { signal: controller.signal })).rejects.toMatchObject({
        name: 'AbortError'
      });

      expect(awaitBeforeCall).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
    });

    it('does not call generate when aborted while waiting for the rate limiter', async () => {
      const controller = new AbortController();
      awaitBeforeCall.mockImplementation(async () => controller.abort());

      await expect(manager.addHighPriorityTask(REQUEST, { signal: controller.signal })).rejects.toMatchObject({
        name: 'AbortError'
      });

      expect(generate).not.toHaveBeenCalled();
    });

    it('does not retry a call that failed because it was aborted', async () => {
      const controller = new AbortController();
      generate.mockImplementation(async () => {
        controller.abort();
        throw new Error('request aborted');
      });

      await expect(manager.addHighPriorityTask(REQUEST, { signal: controller.signal })).rejects.toThrow(
        'request aborted'
      );

      expect(generate).toHaveBeenCalledTimes(1);
    });
    it('keeps the queue slot until a call aborted while it runs has ended', async () => {
      const controller = new AbortController();
      let fail!: () => void;
      generate.mockImplementationOnce(
        () => new Promise((_resolve, reject) => (fail = () => reject(new Error('request aborted'))))
      );
      generate.mockResolvedValue('next');
      const running = manager.addHighPriorityTask(REQUEST, { signal: controller.signal });
      await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
      const next = manager.addHighPriorityTask(REQUEST);

      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(generate).toHaveBeenCalledTimes(1);

      fail();
      await expect(running).rejects.toThrow('request aborted');
      await expect(next).resolves.toBe('next');
    });
  });

  describe('retries without a signal', () => {
    // A provider SDK error: the HTTP status and the response headers
    const providerError = (status: number, message: string, headers: Record<string, string> = {}) =>
      Object.assign(new Error(message), { status, headers });

    it('retries a failing call and returns the first success', async () => {
      generate.mockRejectedValueOnce(providerError(503, 'fail 1')).mockRejectedValueOnce(providerError(429, 'fail 2'));
      generate.mockResolvedValue('response');

      await expect(manager.addHighPriorityTask(REQUEST)).resolves.toBe('response');

      expect(generate).toHaveBeenCalledTimes(3);
      expect(generate).toHaveBeenLastCalledWith(BODY, undefined);
    });

    it('rejects with the last error after retryAttemptsLimit attempts', async () => {
      generate.mockRejectedValueOnce(providerError(500, 'fail 1')).mockRejectedValueOnce(providerError(502, 'fail 2'));
      generate.mockRejectedValue(providerError(503, 'fail 3'));

      await expect(manager.addHighPriorityTask(REQUEST)).rejects.toThrow('fail 3');

      expect(generate).toHaveBeenCalledTimes(CONFIG.retryAttemptsLimit);
    });

    it.each([400, 401, 404])('does not retry a %i response', async (status) => {
      generate.mockRejectedValue(providerError(status, 'bad request'));

      await expect(manager.addHighPriorityTask(REQUEST)).rejects.toThrow('bad request');

      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('does not retry an error that is not a provider or network failure', async () => {
      generate.mockRejectedValue(new TypeError('cannot read the response'));

      await expect(manager.addHighPriorityTask(REQUEST)).rejects.toThrow('cannot read the response');

      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('stops waiting for Retry-After when the signal aborts', async () => {
      const controller = new AbortController();
      generate.mockImplementationOnce(async () => {
        setTimeout(() => controller.abort(new Error('client went away')), 10);
        throw providerError(429, 'rate limited', { 'retry-after': '60' });
      });

      const started = Date.now();
      await expect(manager.addHighPriorityTask(REQUEST, { signal: controller.signal })).rejects.toThrow(
        'client went away'
      );
      expect(Date.now() - started).toBeLessThan(5000);
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('waits as long as Retry-After asks before retrying a 429 response', async () => {
      vi.useFakeTimers();
      try {
        const llmApi = {
          generate,
          reduceMessages: () => 'hello',
          extractUsedTokens: () => 1,
          tokenRateLimiter: { awaitBeforeCall, setUsedTokens: vi.fn(), setUsedRequest: vi.fn() },
          llmTokenizer: { calculateTokensFromString: () => 1 }
        } as unknown as Strategy.LLM.LLMApi;
        const slow = new GenerateCallManager<Body, unknown>('test', { ...CONFIG, retryDelay: 100 }, llmApi);
        generate.mockRejectedValueOnce(providerError(429, 'rate limited', { 'retry-after': '2' }));
        generate.mockResolvedValue('response');

        const result = slow.addHighPriorityTask(REQUEST);
        await vi.advanceTimersByTimeAsync(1999);
        expect(generate).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);

        await expect(result).resolves.toBe('response');
        expect(generate).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('task queue', () => {
    const request = (text: string, priority: number) => ({ ...REQUEST, llmBody: { messages: [text] }, priority });

    // The first call holds the queue, so the next ones wait and are ordered by priority
    function holdFirstCall() {
      let release!: () => void;
      generate.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve('first'))));
      generate.mockImplementation(async (body) => body.messages[0]);
      return () => release();
    }

    it('runs one call at a time, the higher priority first', async () => {
      const release = holdFirstCall();
      const first = manager.addHighPriorityTask(request('first', 30));
      await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));

      const low = manager.addHighPriorityTask(request('low', 10));
      const high = manager.addHighPriorityTask(request('high', 50));
      expect(manager.getCountOfHighPriorityTaskQueue()).toBe(2);
      release();

      await expect(Promise.all([first, low, high])).resolves.toEqual(['first', 'low', 'high']);
      expect(generate.mock.calls.map(([body]) => body.messages[0])).toEqual(['first', 'high', 'low']);
    });

    it('rejects a call once highPriorityTasksLimit calls are waiting', async () => {
      const llmApi = {
        generate,
        reduceMessages: () => 'hello',
        extractUsedTokens: () => 1,
        tokenRateLimiter: { awaitBeforeCall, setUsedTokens: vi.fn(), setUsedRequest: vi.fn() },
        llmTokenizer: { calculateTokensFromString: () => 1 }
      } as unknown as Strategy.LLM.LLMApi;
      const limited = new GenerateCallManager<Body, unknown>('test', { ...CONFIG, highPriorityTasksLimit: 1 }, llmApi);
      const release = holdFirstCall();
      const first = limited.addHighPriorityTask(request('first', 30));
      await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
      const waiting = limited.addHighPriorityTask(request('waiting', 30));

      await expect(limited.addHighPriorityTask(request('rejected', 30))).rejects.toThrow('Too many high priority task');
      release();
      await expect(Promise.all([first, waiting])).resolves.toEqual(['first', 'waiting']);
    });
    it('drops a call aborted while it waits in the queue', async () => {
      const release = holdFirstCall();
      const first = manager.addHighPriorityTask(request('first', 30));
      await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
      const controller = new AbortController();
      const aborted = manager.addHighPriorityTask(request('aborted', 30), { signal: controller.signal });
      expect(manager.getCountOfHighPriorityTaskQueue()).toBe(1);

      controller.abort();

      await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
      expect(manager.getCountOfHighPriorityTaskQueue()).toBe(0);
      release();
      await expect(first).resolves.toBe('first');
      expect(generate).toHaveBeenCalledTimes(1);
    });
  });

  describe('concurrency', () => {
    const llmApiWith = (tokenRateLimiter: Strategy.LLM.LlmTokenRateLimiter, tokens = 1) =>
      ({
        generate,
        reduceMessages: () => 'hello',
        extractUsedTokens: () => tokens,
        tokenRateLimiter,
        llmTokenizer: { calculateTokensFromString: () => tokens }
      }) as unknown as Strategy.LLM.LLMApi;

    it('uses the configured concurrency', async () => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      generate.mockImplementation(async (body) => {
        await held;
        return body.messages[0];
      });
      const limiter = { awaitBeforeCall, setUsedTokens: vi.fn(), setUsedRequest: vi.fn() };
      const parallel = new GenerateCallManager<Body, unknown>(
        'test',
        { ...CONFIG, concurrency: 2 },
        llmApiWith(limiter)
      );

      const calls = [parallel.addHighPriorityTask(REQUEST), parallel.addHighPriorityTask(REQUEST)];

      // Both calls run before either ends
      await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
      release();
      await expect(Promise.all(calls)).resolves.toEqual(['hello', 'hello']);
    });

    it('rejects concurrency 0 and 1.5', () => {
      const limiter = { awaitBeforeCall, setUsedTokens: vi.fn(), setUsedRequest: vi.fn() };

      for (const concurrency of [0, 1.5]) {
        expect(() => new GenerateCallManager('test', { ...CONFIG, concurrency }, llmApiWith(limiter))).toThrow(
          RangeError
        );
      }
    });

    it('acquire is race-free', async () => {
      vi.useFakeTimers();
      const limiter = new LlmTokenRateLimiter({
        newTokensPerSecond: 1000,
        newRequestsPerSecond: 10,
        maxTokens: 1000,
        maxRequests: 10,
        maxAwaitSeconds: 5
      });
      try {
        generate.mockReturnValue(new Promise(() => {}));
        // The budget covers one call of 600 tokens, so the second call waits for 200 tokens to refill
        const parallel = new GenerateCallManager<Body, unknown>(
          'test',
          { ...CONFIG, concurrency: 2 },
          llmApiWith(limiter, 600)
        );

        void parallel.addHighPriorityTask(REQUEST);
        void parallel.addHighPriorityTask(REQUEST);
        await vi.advanceTimersByTimeAsync(199);
        expect(generate).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);

        expect(generate).toHaveBeenCalledTimes(2);
      } finally {
        limiter.stop();
        vi.useRealTimers();
      }
    });
  });

  describe('token reservation', () => {
    const PREDICTED = 7;
    const ACTUAL = 10;
    const setUsedTokens = vi.fn<(usedTokens: number) => void>();
    const setUsedRequest = vi.fn<() => void>();
    const acquire = vi.fn<(tokens: number, signal?: AbortSignal) => Promise<void>>();

    function managerWith(tokenRateLimiter: Strategy.LLM.LlmTokenRateLimiter, config: Partial<GenerateConfig> = {}) {
      const llmApi = {
        generate,
        reduceMessages: () => 'hello',
        extractUsedTokens: () => ACTUAL,
        tokenRateLimiter,
        llmTokenizer: { calculateTokensFromString: () => PREDICTED }
      } as unknown as Strategy.LLM.LLMApi;
      return new GenerateCallManager<Body, unknown>('test', { ...CONFIG, ...config }, llmApi);
    }
    // A rate limiter without acquire(), like one written before it existed
    const checkOnlyLimiter = () => ({ awaitBeforeCall, setUsedTokens, setUsedRequest });

    beforeEach(() => {
      setUsedTokens.mockReset();
      setUsedRequest.mockReset();
      acquire.mockReset().mockResolvedValue(undefined);
    });

    it('reserves before the provider call', async () => {
      generate.mockResolvedValue('response');
      const reserving = managerWith({ acquire, awaitBeforeCall, setUsedTokens, setUsedRequest });

      await expect(reserving.addHighPriorityTask(REQUEST)).resolves.toBe('response');

      expect(acquire).toHaveBeenCalledWith(PREDICTED, undefined);
      expect(acquire.mock.invocationCallOrder[0]).toBeLessThan(generate.mock.invocationCallOrder[0]);
      expect(awaitBeforeCall).not.toHaveBeenCalled();
      // acquire() takes the request too
      expect(setUsedRequest).not.toHaveBeenCalled();
    });

    it('reserves with awaitBeforeCall when the rate limiter has no acquire', async () => {
      generate.mockResolvedValue('response');

      await expect(managerWith(checkOnlyLimiter()).addHighPriorityTask(REQUEST)).resolves.toBe('response');

      expect(awaitBeforeCall).toHaveBeenCalledWith(PREDICTED);
      expect(setUsedTokens.mock.invocationCallOrder[0]).toBeLessThan(generate.mock.invocationCallOrder[0]);
      expect(setUsedRequest.mock.invocationCallOrder[0]).toBeLessThan(generate.mock.invocationCallOrder[0]);
      expect(setUsedRequest).toHaveBeenCalledTimes(1);
    });

    it('settles to actual usage', async () => {
      generate.mockResolvedValue('response');

      await managerWith(checkOnlyLimiter()).addHighPriorityTask(REQUEST);

      expect(setUsedTokens.mock.calls).toEqual([[PREDICTED], [ACTUAL - PREDICTED]]);
      expect(setUsedRequest).toHaveBeenCalledTimes(1);
    });

    it('refunds tokens when the call fails before any event', async () => {
      generate.mockRejectedValue(new TypeError('cannot read the response'));

      await expect(managerWith(checkOnlyLimiter()).addHighPriorityTask(REQUEST)).rejects.toThrow(
        'cannot read the response'
      );

      expect(setUsedTokens.mock.calls).toEqual([[PREDICTED], [-PREDICTED]]);
      // The request stays spent
      expect(setUsedRequest).toHaveBeenCalledTimes(1);
    });

    it('refunds once after the last retry', async () => {
      generate.mockRejectedValue(Object.assign(new Error('unavailable'), { status: 503, headers: {} }));

      await expect(managerWith(checkOnlyLimiter()).addHighPriorityTask(REQUEST)).rejects.toThrow('unavailable');

      expect(generate).toHaveBeenCalledTimes(CONFIG.retryAttemptsLimit);
      expect(setUsedTokens.mock.calls).toEqual([[PREDICTED], [-PREDICTED]]);
    });

    it('abort keeps the reservation', async () => {
      const controller = new AbortController();
      generate.mockImplementation(async () => {
        controller.abort();
        throw new Error('request aborted');
      });

      await expect(
        managerWith(checkOnlyLimiter()).addHighPriorityTask(REQUEST, { signal: controller.signal })
      ).rejects.toThrow('request aborted');

      expect(setUsedTokens.mock.calls).toEqual([[PREDICTED]]);
      expect(setUsedRequest).toHaveBeenCalledTimes(1);
    });

    it('reserveTokens false keeps charge-on-success', async () => {
      generate.mockResolvedValue('response');
      const charging = managerWith(
        { acquire, awaitBeforeCall, setUsedTokens, setUsedRequest },
        { reserveTokens: false }
      );

      await expect(charging.addHighPriorityTask(REQUEST)).resolves.toBe('response');

      expect(acquire).not.toHaveBeenCalled();
      expect(awaitBeforeCall).toHaveBeenCalledWith(PREDICTED);
      expect(setUsedTokens.mock.calls).toEqual([[ACTUAL]]);
      expect(setUsedRequest).toHaveBeenCalledTimes(1);
      expect(setUsedTokens.mock.invocationCallOrder[0]).toBeGreaterThan(generate.mock.invocationCallOrder[0]);
    });

    it('reserveTokens false charges nothing for a failed call', async () => {
      generate.mockRejectedValue(new TypeError('cannot read the response'));
      const charging = managerWith(checkOnlyLimiter(), { reserveTokens: false });

      await expect(charging.addHighPriorityTask(REQUEST)).rejects.toThrow('cannot read the response');

      expect(setUsedTokens).not.toHaveBeenCalled();
      expect(setUsedRequest).not.toHaveBeenCalled();
    });

    it('subclass override of makeGenerateRequest is still called', async () => {
      const overridden = vi.fn();
      class TracingManager extends GenerateCallManager<Body, unknown> {
        async makeGenerateRequest(
          llmRequest: Body,
          options?: Strategy.LLM.CallOptions,
          reservation?: { tokens: number }
        ): Promise<unknown> {
          overridden(llmRequest, options, reservation);
          return super.makeGenerateRequest(llmRequest, options, reservation);
        }
      }
      generate.mockResolvedValue('response');
      const llmApi = {
        generate,
        reduceMessages: () => 'hello',
        extractUsedTokens: () => ACTUAL,
        tokenRateLimiter: { acquire, awaitBeforeCall, setUsedTokens, setUsedRequest },
        llmTokenizer: { calculateTokensFromString: () => PREDICTED }
      } as unknown as Strategy.LLM.LLMApi;

      await expect(new TracingManager('test', CONFIG, llmApi).addHighPriorityTask(REQUEST)).resolves.toBe('response');

      expect(overridden).toHaveBeenCalledWith(BODY, undefined, { tokens: PREDICTED });
      expect(setUsedTokens.mock.calls).toEqual([[ACTUAL - PREDICTED]]);
    });
  });

  it('errors have literal names', () => {
    expect(new TooManyHighPriorityTasksError('full')).toHaveProperty('name', 'TooManyHighPriorityTasksError');
    expect(new LlmCallManagerLongAwaitError('slow')).toHaveProperty('name', 'LlmCallManagerLongAwaitError');
    // Set on the instance, so a minifier that renames the classes does not change them
    expect(Object.hasOwn(new TooManyHighPriorityTasksError('full'), 'name')).toBe(true);
    expect(Object.hasOwn(new LlmCallManagerLongAwaitError('slow'), 'name')).toBe(true);
  });

  describe('stop', () => {
    it('stops the rate limiter of the LLM strategy', () => {
      const stop = vi.fn();
      const llmApi = { tokenRateLimiter: { stop } } as unknown as Strategy.LLM.LLMApi;

      new GenerateCallManager('test', CONFIG, llmApi).stop();

      expect(stop).toHaveBeenCalledTimes(1);
    });

    it('works with a rate limiter that has no stop()', () => {
      expect(() => manager.stop()).not.toThrow();
    });
  });
});
