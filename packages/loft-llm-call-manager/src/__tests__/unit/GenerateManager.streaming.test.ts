import { Interface, Logger, Strategy, StreamIdleTimeoutError } from '@moc-global/loft-definitions';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GenerateCallManager } from '../../GenerateManager';
import { GenerateConfig } from '../../types';

type Body = { messages: string[] };
type Event = Strategy.LLM.LlmStreamEvent;
type Sink = Strategy.LLM.LlmStreamSink;

const BODY: Body = { messages: ['hello'] };
const REQUEST: Strategy.LLM.LLMRequest<Body> = {
  sessionId: 'session-1',
  requestType: Strategy.LLM.LLMRequestType.GENERATE,
  llmName: 'fake',
  llmBody: BODY,
  priority: 30
};
const CONFIG: GenerateConfig = { highPriorityTasksLimit: 10, retryDelay: 0, retryAttemptsLimit: 3 };
// With a retryDelay of 0 the call waits 0 ms before a retry, but the fake clock runs a zero-delay timer that is set
// while it advances 1 ms later
const RETRY_WAIT_MS = 1;
const PREDICTED = 7;
const ACTUAL = 10;

const DELTA: Event = { type: 'text-delta', delta: 'Hel' };
const ACTIVITY: Event = { type: 'activity' };
const USAGE: Event = { type: 'usage', usage: { inputTokens: 1 } };

// What the fake provider does in one attempt: emit an event, wait (an abort ends the wait), wait until aborted, or fail
type Step = { event: Event } | { wait: number } | { hang: true } | { fail: unknown };

// A provider SDK error: the HTTP status and the response headers
const providerError = (status: number, headers: Record<string, string> = {}) =>
  Object.assign(new Error(`status ${status}`), { status, headers });

// What an SDK rejects with when its signal aborts
const sdkAbortError = () => Object.assign(new Error('Request was aborted.'), { name: 'AbortError' });

function waitOrAbort(ms: number | undefined, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(sdkAbortError());
      return;
    }
    const timer = ms === undefined ? undefined : setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(sdkAbortError());
      },
      { once: true }
    );
  });
}

// The settled state of a promise, readable while the fake clock runs
function track<T>(promise: Promise<T>) {
  const state: { done: boolean; value?: T; error?: unknown } = { done: false };
  promise.then(
    (value) => Object.assign(state, { done: true, value }),
    (error) => Object.assign(state, { done: true, error })
  );
  return state;
}

describe('GenerateCallManager streaming', () => {
  const generate = vi.fn<(llmRequest: Body, options?: Strategy.LLM.CallOptions) => Promise<unknown>>();
  const acquire = vi.fn<(tokens: number, signal?: AbortSignal) => Promise<void>>();
  const setUsedTokens = vi.fn<(usedTokens: number) => void>();
  const setUsedRequest = vi.fn<() => void>();
  const awaitBeforeCall = vi.fn<(requestedTokens?: number) => Promise<void>>();

  // The options the provider got, per attempt
  const providerOptions = () => generate.mock.calls.map(([, options]) => options ?? {});

  // Each provider call plays the next script and then resolves with 'response'
  function script(...attempts: Step[][]) {
    let call = 0;
    generate.mockImplementation(async (_body, options) => {
      for (const step of attempts[call++] ?? []) {
        if ('event' in step) options?.onEvent?.(step.event);
        else if ('wait' in step) await waitOrAbort(step.wait, options?.signal);
        else if ('hang' in step) await waitOrAbort(undefined, options?.signal);
        else throw step.fail;
      }
      return 'response';
    });
  }

  function managerWith(config: Partial<GenerateConfig> = {}, extractUsedTokens: () => number = () => ACTUAL) {
    const llmApi = {
      generate,
      reduceMessages: () => 'hello',
      extractUsedTokens,
      tokenRateLimiter: { acquire, awaitBeforeCall, setUsedTokens, setUsedRequest },
      llmTokenizer: { calculateTokensFromString: () => PREDICTED }
    } as unknown as Strategy.LLM.LLMApi;
    return new GenerateCallManager<Body, unknown>('test', { ...CONFIG, ...config }, llmApi);
  }

  // A consumer that shows every event (true) or keeps every event back (false)
  const sinkReturning = (delivered: boolean) => vi.fn<Sink>(() => delivered);
  const eventTypes = (sink: ReturnType<typeof sinkReturning>) => sink.mock.calls.map(([event]) => event.type);

  beforeAll(() => {
    Logger.configure({ logLevel: Interface.LogLevel.NONE });
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    for (const mock of [generate, acquire, setUsedTokens, setUsedRequest, awaitBeforeCall]) mock.mockReset();
    acquire.mockResolvedValue(undefined);
    awaitBeforeCall.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('retries', () => {
    it('retries a retryable error before any delta', async () => {
      script([{ fail: providerError(503) }], [{ event: DELTA }]);
      const sink = sinkReturning(true);

      const call = track(managerWith().addHighPriorityTask(REQUEST, { onEvent: sink }));
      await vi.advanceTimersByTimeAsync(0);

      expect(call).toEqual({ done: true, value: 'response' });
      expect(generate).toHaveBeenCalledTimes(2);
      expect(eventTypes(sink)).toEqual(['request-start', 'request-start', 'text-delta']);
    });

    it('does not retry after a delivered delta', async () => {
      const error = providerError(503);
      script([{ event: DELTA }, { fail: error }], []);

      const call = track(managerWith().addHighPriorityTask(REQUEST, { onEvent: sinkReturning(true) }));
      await vi.advanceTimersByTimeAsync(0);

      expect(call).toEqual({ done: true, error });
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('undelivered deltas keep retries', async () => {
      script([{ event: DELTA }, { fail: providerError(503) }], [{ event: DELTA }]);
      const sink = sinkReturning(false);

      const call = track(managerWith().addHighPriorityTask(REQUEST, { onEvent: sink }));
      await vi.advanceTimersByTimeAsync(0);

      expect(call).toEqual({ done: true, value: 'response' });
      expect(generate).toHaveBeenCalledTimes(2);
    });

    it('a sink that returns nothing does not count as delivered', async () => {
      script([{ event: DELTA }, { fail: providerError(503) }], []);

      const call = track(managerWith().addHighPriorityTask(REQUEST, { onEvent: vi.fn<Sink>() }));
      await vi.advanceTimersByTimeAsync(0);

      expect(call).toEqual({ done: true, value: 'response' });
      expect(generate).toHaveBeenCalledTimes(2);
    });

    it('does not retry an error that cannot succeed on a new attempt', async () => {
      const error = providerError(400);
      script([{ fail: error }], []);

      const call = track(managerWith().addHighPriorityTask(REQUEST, { onEvent: sinkReturning(false) }));
      await vi.advanceTimersByTimeAsync(0);

      expect(call).toEqual({ done: true, error });
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('consumer sink that throws counts as not delivered', async () => {
      const warn = vi.fn();
      const loggerStrategy = { fatal: vi.fn(), error: vi.fn(), warn, info: vi.fn(), debug: vi.fn(), trace: vi.fn() };
      Logger.configure({ logLevel: Interface.LogLevel.WARN, loggerStrategy });
      try {
        script(
          [{ event: DELTA }, { event: { type: 'text-delta', delta: 'secret' } }, { fail: providerError(503) }],
          []
        );
        const sink = vi.fn<Sink>((event) => {
          if (event.type === 'text-delta') throw new Error(`cannot show ${event.delta}`);
          return true;
        });

        const call = track(managerWith().addHighPriorityTask(REQUEST, { onEvent: sink }));
        await vi.advanceTimersByTimeAsync(0);

        // The provider stream went on after the first throw, and the attempt was retried
        expect(call).toEqual({ done: true, value: 'response' });
        expect(eventTypes(sink)).toEqual(['request-start', 'text-delta', 'text-delta', 'request-start']);
        expect(generate).toHaveBeenCalledTimes(2);
        // Only the event type is logged, never the text or the consumer's error
        expect(warn).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(warn.mock.calls)).not.toMatch(/Hel|secret/);
        expect(warn.mock.calls[0][0]).toContain('text-delta');
      } finally {
        Logger.configure({ logLevel: Interface.LogLevel.NONE });
      }
    });

    it('a throwing request-start does not stop the call', async () => {
      script([{ event: DELTA }]);
      const sink = vi.fn<Sink>((event) => {
        if (event.type === 'request-start') throw new Error('consumer broke');
        return true;
      });

      const call = track(managerWith().addHighPriorityTask(REQUEST, { onEvent: sink }));
      await vi.advanceTimersByTimeAsync(0);

      expect(call).toEqual({ done: true, value: 'response' });
      expect(generate).toHaveBeenCalledTimes(1);
    });
  });

  it('request-start once per attempt, after acquire', async () => {
    script([{ fail: providerError(503) }], [{ event: DELTA }]);
    const sink = sinkReturning(true);

    const call = track(managerWith().addHighPriorityTask(REQUEST, { onEvent: sink }));
    await vi.advanceTimersByTimeAsync(0);

    expect(call.done).toBe(true);
    const [firstStart, secondStart] = sink.mock.invocationCallOrder;
    const [firstAttempt, secondAttempt] = generate.mock.invocationCallOrder;
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire.mock.invocationCallOrder[0]).toBeLessThan(firstStart);
    expect(firstStart).toBeLessThan(firstAttempt);
    expect(firstAttempt).toBeLessThan(secondStart);
    expect(secondStart).toBeLessThan(secondAttempt);
    expect(eventTypes(sink).filter((type) => type === 'request-start')).toHaveLength(2);
  });

  it('provider receives a combined signal that aborts on caller abort', async () => {
    script([{ hang: true }]);
    const controller = new AbortController();
    const sink = sinkReturning(true);

    const call = track(managerWith().addHighPriorityTask(REQUEST, { signal: controller.signal, onEvent: sink }));
    await vi.advanceTimersByTimeAsync(0);
    const [options] = providerOptions();

    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal).not.toBe(controller.signal);
    expect(options.signal?.aborted).toBe(false);
    // The provider gets the wrapper, not the consumer's sink
    expect(options.onEvent).toEqual(expect.any(Function));
    expect(options.onEvent).not.toBe(sink);

    const reason = new Error('client went away');
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);

    expect(options.signal?.aborted).toBe(true);
    expect(options.signal?.reason).toBe(reason);
    expect(call.done).toBe(true);
  });

  it('drops an event the provider sends after the attempt ended', async () => {
    let providerSink: Sink | undefined;
    generate.mockImplementation(async (_body, options) => {
      providerSink = options?.onEvent;
      return 'response';
    });
    const sink = sinkReturning(true);

    const call = track(managerWith().addHighPriorityTask(REQUEST, { onEvent: sink }));
    await vi.advanceTimersByTimeAsync(0);
    expect(call).toEqual({ done: true, value: 'response' });

    expect(providerSink?.(DELTA)).toBe(false);
    expect(eventTypes(sink)).toEqual(['request-start']);
    // No idle timer starts either
    expect(vi.getTimerCount()).toBe(0);
  });

  it('takes a provider that returns a plain value or a thenable', async () => {
    // A provider written in JavaScript may return something other than a native promise
    const thenable = { then: (resolve: (value: unknown) => void) => resolve('from a thenable') };
    generate
      .mockImplementationOnce(() => 'plain value' as unknown as Promise<unknown>)
      .mockImplementationOnce(() => thenable as unknown as Promise<unknown>);
    const manager = managerWith({ streamIdleTimeoutMs: 1000, streamFirstEventTimeoutMs: 1000 });

    const plain = track(manager.addHighPriorityTask(REQUEST, { onEvent: sinkReturning(true) }));
    const fromThenable = track(manager.addHighPriorityTask(REQUEST, { onEvent: sinkReturning(true) }));
    await vi.advanceTimersByTimeAsync(0);

    expect(plain).toEqual({ done: true, value: 'plain value' });
    expect(fromThenable).toEqual({ done: true, value: 'from a thenable' });
    expect(vi.getTimerCount()).toBe(0);
  });

  describe('an event sent after the attempt was aborted', () => {
    // A provider that emits one more event once its signal aborted, as a buffered chunk would, and then rejects
    function emitAfterAbort() {
      const late: unknown[] = [];
      generate.mockImplementation(
        (_body, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener(
              'abort',
              () => {
                late.push(options.onEvent?.(DELTA));
                reject(sdkAbortError());
              },
              { once: true }
            );
          })
      );
      return late;
    }

    it('is not passed on after a timeout, but still keeps the reservation', async () => {
      const late = emitAfterAbort();
      const sink = sinkReturning(true);

      const call = track(
        managerWith({ streamFirstEventTimeoutMs: 1000, retryAttemptsLimit: 2 }).addHighPriorityTask(REQUEST, {
          onEvent: sink
        })
      );
      await vi.advanceTimersByTimeAsync(2000 + RETRY_WAIT_MS);

      expect(late).toEqual([false, false]);
      expect(eventTypes(sink)).toEqual(['request-start', 'request-start']);
      // Not delivered, so the first timeout was retried
      expect(generate).toHaveBeenCalledTimes(2);
      expect(call.error).toBeInstanceOf(StreamIdleTimeoutError);
      // The provider had sent an event, so the tokens are not given back
      expect(setUsedTokens).not.toHaveBeenCalled();
    });

    it('is not passed on after the caller aborted', async () => {
      const late = emitAfterAbort();
      const sink = sinkReturning(true);
      const controller = new AbortController();

      const call = track(managerWith().addHighPriorityTask(REQUEST, { signal: controller.signal, onEvent: sink }));
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);

      expect(late).toEqual([false]);
      expect(eventTypes(sink)).toEqual(['request-start']);
      expect(call.error).toMatchObject({ name: 'AbortError' });
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('idle timeout', () => {
    it('idle timeout aborts between chunks', async () => {
      script([{ event: DELTA }, { hang: true }]);

      const call = track(
        managerWith({ streamIdleTimeoutMs: 1000 }).addHighPriorityTask(REQUEST, { onEvent: sinkReturning(true) })
      );
      await vi.advanceTimersByTimeAsync(999);
      expect(call.done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(call.done).toBe(true);
      expect(call.error).toBeInstanceOf(StreamIdleTimeoutError);
      expect(call.error).toMatchObject({ name: 'StreamIdleTimeoutError', timeoutMs: 1000 });
      expect(providerOptions()[0].signal?.reason).toBe(call.error);
      // The delta was delivered, so the timeout is not retried
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('defaults to 60 seconds', async () => {
      script([{ event: DELTA }, { hang: true }]);

      const call = track(managerWith().addHighPriorityTask(REQUEST, { onEvent: sinkReturning(true) }));
      await vi.advanceTimersByTimeAsync(59_999);
      expect(call.done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(call.error).toMatchObject({ name: 'StreamIdleTimeoutError', timeoutMs: 60_000 });
    });

    it('no idle timeout before the first event', async () => {
      script([{ wait: 5000 }, { event: DELTA }]);

      const call = track(
        managerWith({ streamIdleTimeoutMs: 1000 }).addHighPriorityTask(REQUEST, { onEvent: sinkReturning(true) })
      );
      await vi.advanceTimersByTimeAsync(5000);

      expect(call).toEqual({ done: true, value: 'response' });
      // A timeout and a retry would end the same way, so the attempts are counted
      expect(generate).toHaveBeenCalledTimes(1);
      expect(providerOptions()[0].signal?.aborted).toBe(false);
    });

    it('restarts the running idle timer instead of setting a new one per event', async () => {
      script(Array.from({ length: 100 }, (): Step => ({ event: DELTA })));
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      const call = track(
        managerWith({ streamIdleTimeoutMs: 1000, streamFirstEventTimeoutMs: 2000 }).addHighPriorityTask(REQUEST, {
          onEvent: sinkReturning(true)
        })
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(call).toEqual({ done: true, value: 'response' });
      // The first-event timer, then one idle timer for all 100 events
      expect(setTimeoutSpy.mock.calls.map(([, ms]) => ms)).toEqual([2000, 1000]);
      setTimeoutSpy.mockRestore();
    });

    it('activity restarts the idle timer', async () => {
      script([{ event: DELTA }, { wait: 800 }, { event: ACTIVITY }, { wait: 800 }, { event: USAGE }, { wait: 800 }]);

      const call = track(
        managerWith({ streamIdleTimeoutMs: 1000 }).addHighPriorityTask(REQUEST, { onEvent: sinkReturning(true) })
      );
      await vi.advanceTimersByTimeAsync(2400);

      expect(call).toEqual({ done: true, value: 'response' });
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('a usage report does not start it: silent thinking after it does not time out', async () => {
      const REASONING: Event = { type: 'reasoning-delta', delta: 'Thinking' };
      for (const first of [DELTA, REASONING]) {
        generate.mockReset();
        script([{ event: USAGE }, { wait: 70_000 }, { event: first }, { wait: 30_000 }, { event: DELTA }]);

        const call = track(managerWith().addHighPriorityTask(REQUEST, { onEvent: sinkReturning(true) }));
        await vi.advanceTimersByTimeAsync(100_000);

        expect(call).toEqual({ done: true, value: 'response' });
        expect(generate).toHaveBeenCalledTimes(1);
        expect(providerOptions()[0].signal?.aborted).toBe(false);
      }
    });

    it('activity starts it: silence after it times out', async () => {
      script([{ event: USAGE }, { event: ACTIVITY }, { wait: 70_000 }, { event: DELTA }]);

      const call = track(
        managerWith({ retryAttemptsLimit: 1 }).addHighPriorityTask(REQUEST, { onEvent: sinkReturning(true) })
      );
      await vi.advanceTimersByTimeAsync(59_999);
      expect(call.done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(call.error).toMatchObject({ name: 'StreamIdleTimeoutError', timeoutMs: 60_000 });
    });

    it('once started, a usage report restarts it', async () => {
      script([{ event: DELTA }, { wait: 50_000 }, { event: USAGE }, { wait: 50_000 }, { event: DELTA }]);

      const call = track(managerWith().addHighPriorityTask(REQUEST, { onEvent: sinkReturning(true) }));
      await vi.advanceTimersByTimeAsync(100_000);

      expect(call).toEqual({ done: true, value: 'response' });
      expect(providerOptions()[0].signal?.aborted).toBe(false);
    });

    it('a usage report alone still counts as a provider event: the reservation is kept', async () => {
      const error = new TypeError('cannot read the response');
      script([{ event: USAGE }, { fail: error }]);

      const call = track(managerWith().addHighPriorityTask(REQUEST, { onEvent: sinkReturning(false) }));
      await vi.advanceTimersByTimeAsync(0);

      expect(call).toEqual({ done: true, error });
      expect(setUsedTokens).not.toHaveBeenCalled();
    });

    it('idle timeout with nothing delivered is retried', async () => {
      script([{ event: DELTA }, { hang: true }], [{ event: DELTA }]);

      const call = track(
        managerWith({ streamIdleTimeoutMs: 1000 }).addHighPriorityTask(REQUEST, { onEvent: sinkReturning(false) })
      );
      await vi.advanceTimersByTimeAsync(1000 + RETRY_WAIT_MS);

      expect(call).toEqual({ done: true, value: 'response' });
      expect(generate).toHaveBeenCalledTimes(2);
    });

    it('rejects with the timeout once the attempts run out', async () => {
      script([{ event: DELTA }, { hang: true }], [{ event: DELTA }, { hang: true }]);

      const call = track(
        managerWith({ streamIdleTimeoutMs: 1000, retryAttemptsLimit: 2 }).addHighPriorityTask(REQUEST, {
          onEvent: sinkReturning(false)
        })
      );
      await vi.advanceTimersByTimeAsync(2000 + RETRY_WAIT_MS);

      expect(call.error).toBeInstanceOf(StreamIdleTimeoutError);
      expect(generate).toHaveBeenCalledTimes(2);
    });

    it('caller abort during the idle timer yields the abort, not a timeout', async () => {
      script([{ event: DELTA }, { hang: true }]);
      const controller = new AbortController();

      const call = track(
        managerWith({ streamIdleTimeoutMs: 1000 }).addHighPriorityTask(REQUEST, {
          signal: controller.signal,
          onEvent: sinkReturning(false)
        })
      );
      await vi.advanceTimersByTimeAsync(500);
      controller.abort(new Error('client went away'));
      await vi.advanceTimersByTimeAsync(0);

      expect(call.done).toBe(true);
      expect(call.error).toMatchObject({ name: 'AbortError' });
      expect(call.error).not.toBeInstanceOf(StreamIdleTimeoutError);
      await vi.advanceTimersByTimeAsync(5000);
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('a caller abort after the idle timer fired ends the retry wait, and the late provider error is dropped', async () => {
      // A provider that ends only when the test lets it
      let fail!: (error: unknown) => void;
      generate.mockImplementation((_body, options) => {
        options?.onEvent?.(DELTA);
        return new Promise((_resolve, reject) => (fail = reject));
      });
      const controller = new AbortController();

      const call = track(
        managerWith({ streamIdleTimeoutMs: 1000 }).addHighPriorityTask(REQUEST, {
          signal: controller.signal,
          onEvent: sinkReturning(false)
        })
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(providerOptions()[0].signal?.reason).toBeInstanceOf(StreamIdleTimeoutError);
      // The timer ended the attempt, so the call waits to retry
      expect(call.done).toBe(false);
      const reason = new Error('client went away');
      controller.abort(reason);
      fail(sdkAbortError());
      await vi.advanceTimersByTimeAsync(0);

      expect(call).toEqual({ done: true, error: reason });
      expect(generate).toHaveBeenCalledTimes(1);
    });

    describe('a provider that ignores the abort', () => {
      const unhandled = vi.fn();

      beforeEach(() => {
        unhandled.mockReset();
        process.on('unhandledRejection', unhandled);
      });

      afterEach(() => {
        process.off('unhandledRejection', unhandled);
      });

      // Unhandled rejections are reported on a later turn of the event loop
      const expectNoUnhandledRejection = async () => {
        await new Promise((resolve) => setImmediate(resolve));
        expect(unhandled).not.toHaveBeenCalled();
      };

      it('still ends the attempt at the timeout, and its late result or error is dropped', async () => {
        // Each attempt sends a delta and then ends only when the test lets it, whatever the signal does
        const settle: { resolve: (value: unknown) => void; reject: (error: unknown) => void }[] = [];
        generate.mockImplementation((_body, options) => {
          options?.onEvent?.(DELTA);
          return new Promise((resolve, reject) => settle.push({ resolve, reject }));
        });
        const sink = sinkReturning(false);

        const call = track(
          managerWith({ streamIdleTimeoutMs: 1000, retryAttemptsLimit: 2 }).addHighPriorityTask(REQUEST, {
            onEvent: sink
          })
        );
        await vi.advanceTimersByTimeAsync(1000 + RETRY_WAIT_MS);
        // The first attempt timed out and the second one runs
        expect(generate).toHaveBeenCalledTimes(2);
        settle[0].reject(providerError(503));
        await vi.advanceTimersByTimeAsync(1000);

        expect(call.error).toBeInstanceOf(StreamIdleTimeoutError);
        settle[1].resolve('too late');
        await vi.advanceTimersByTimeAsync(0);
        expect(call.error).toBeInstanceOf(StreamIdleTimeoutError);
        expect(eventTypes(sink)).toEqual(['request-start', 'text-delta', 'request-start', 'text-delta']);
        expect(vi.getTimerCount()).toBe(0);
        await expectNoUnhandledRejection();
      });

      it('keeps the reservation when it streams after a first-event timeout ended its attempt', async () => {
        // Each attempt stays silent and never ends; the test sends events through the sink it got
        const providerSinks: Sink[] = [];
        generate.mockImplementation((_body, options) => {
          if (options?.onEvent) providerSinks.push(options.onEvent);
          return new Promise(() => {});
        });
        const sink = sinkReturning(true);

        const call = track(
          managerWith({ streamFirstEventTimeoutMs: 1000, retryAttemptsLimit: 2 }).addHighPriorityTask(REQUEST, {
            onEvent: sink
          })
        );
        await vi.advanceTimersByTimeAsync(1000 + RETRY_WAIT_MS);
        expect(generate).toHaveBeenCalledTimes(2);
        // The first attempt's provider starts to stream only now, while the second attempt waits
        expect(providerSinks[0](DELTA)).toBe(false);
        // It does not hold off the second attempt's first-event timeout
        await vi.advanceTimersByTimeAsync(1000);

        expect(call.error).toBeInstanceOf(StreamIdleTimeoutError);
        expect(eventTypes(sink)).toEqual(['request-start', 'request-start']);
        // The provider had sent an event, so the tokens are not given back
        expect(setUsedTokens).not.toHaveBeenCalled();
        await expectNoUnhandledRejection();
      });

      it('the caller abort ends the attempt at once with its reason, and frees the queue slot', async () => {
        generate.mockImplementation((_body, options) => {
          options?.onEvent?.(DELTA);
          return new Promise(() => {});
        });
        const controller = new AbortController();
        const addListener = vi.spyOn(controller.signal, 'addEventListener');
        const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
        // No timer runs, so only the abort can end the attempt
        const manager = managerWith({ streamIdleTimeoutMs: 0, streamFirstEventTimeoutMs: 0 });

        const call = track(
          manager.addHighPriorityTask(REQUEST, { signal: controller.signal, onEvent: sinkReturning(true) })
        );
        const next = track(manager.addHighPriorityTask(REQUEST, { onEvent: sinkReturning(true) }));
        await vi.advanceTimersByTimeAsync(500);
        // The second call waits for the first one's queue slot
        expect(generate).toHaveBeenCalledTimes(1);
        const reason = new Error('client went away');
        controller.abort(reason);
        await vi.advanceTimersByTimeAsync(1);

        expect(call).toEqual({ done: true, error: reason });
        expect(generate).toHaveBeenCalledTimes(2);
        expect(next.done).toBe(false);
        // The attempt's listener on the caller's signal is gone
        const listeners = addListener.mock.calls.map(([, listener]) => listener);
        expect(removeListener.mock.calls.map(([, listener]) => listener)).toEqual(expect.arrayContaining(listeners));
        expect(vi.getTimerCount()).toBe(0);
        await expectNoUnhandledRejection();
      });

      it('without onEvent, the call still waits for the provider', async () => {
        let resolve!: (value: unknown) => void;
        generate.mockImplementation(() => new Promise((done) => (resolve = done)));

        const call = track(
          managerWith({ streamIdleTimeoutMs: 1000, streamFirstEventTimeoutMs: 1000 }).addHighPriorityTask(REQUEST)
        );
        await vi.advanceTimersByTimeAsync(5000);
        expect(call.done).toBe(false);
        resolve('response');
        await vi.advanceTimersByTimeAsync(0);

        expect(call).toEqual({ done: true, value: 'response' });
      });
    });

    it('timers cleared after settle and during the retry wait', async () => {
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        script([{ event: DELTA }, { fail: providerError(503, { 'retry-after-ms': '5000' }) }], [{ event: DELTA }]);

        const call = track(
          managerWith({ streamIdleTimeoutMs: 1000, streamFirstEventTimeoutMs: 1000 }).addHighPriorityTask(REQUEST, {
            onEvent: sinkReturning(false)
          })
        );
        await vi.advanceTimersByTimeAsync(0);

        // Only the retry wait is pending: neither timeout runs while the call waits to retry
        expect(generate).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(4999);
        expect(generate).toHaveBeenCalledTimes(1);
        expect(providerOptions()[0].signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);

        expect(call).toEqual({ done: true, value: 'response' });
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(120_000);
        expect(providerOptions().map((options) => options.signal?.aborted)).toEqual([false, false]);
        // Unhandled rejections are reported on a later turn of the event loop
        await new Promise((resolve) => setImmediate(resolve));
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });

    it('streamIdleTimeoutMs 0 disables', async () => {
      script([{ event: DELTA }, { wait: 120_000 }]);

      const call = track(
        managerWith({ streamIdleTimeoutMs: 0 }).addHighPriorityTask(REQUEST, { onEvent: sinkReturning(true) })
      );
      await vi.advanceTimersByTimeAsync(0);
      // Only the provider's own wait
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(120_000);

      expect(call).toEqual({ done: true, value: 'response' });
    });
  });

  describe('first-event timeout', () => {
    it('first-event timeout when configured', async () => {
      script([{ hang: true }], [{ wait: 500 }, { event: DELTA }]);

      const call = track(
        managerWith({ streamFirstEventTimeoutMs: 1000 }).addHighPriorityTask(REQUEST, {
          onEvent: sinkReturning(true)
        })
      );
      await vi.advanceTimersByTimeAsync(999);
      expect(generate).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1 + RETRY_WAIT_MS);

      // Nothing was delivered, so the timeout is retried
      expect(providerOptions()[0].signal?.reason).toMatchObject({ name: 'StreamIdleTimeoutError', timeoutMs: 1000 });
      expect(generate).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(500);
      expect(call).toEqual({ done: true, value: 'response' });
    });

    it('defaults to 10 minutes, also when only usage reports arrive', async () => {
      script([{ wait: 599_000 }, { event: DELTA }], [{ event: USAGE }, { hang: true }]);

      const first = track(managerWith().addHighPriorityTask(REQUEST, { onEvent: sinkReturning(true) }));
      await vi.advanceTimersByTimeAsync(599_000);
      expect(first).toEqual({ done: true, value: 'response' });

      const silent = track(
        managerWith({ retryAttemptsLimit: 1 }).addHighPriorityTask(REQUEST, { onEvent: sinkReturning(false) })
      );
      await vi.advanceTimersByTimeAsync(599_999);
      expect(silent.done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(silent.error).toMatchObject({ name: 'StreamIdleTimeoutError', timeoutMs: 600_000 });
    });

    it('0 turns it off', async () => {
      script([{ wait: 3_600_000 }, { event: DELTA }]);

      const call = track(
        managerWith({ streamFirstEventTimeoutMs: 0 }).addHighPriorityTask(REQUEST, { onEvent: sinkReturning(true) })
      );
      await vi.advanceTimersByTimeAsync(3_600_000);

      expect(call).toEqual({ done: true, value: 'response' });
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('a usage report does not end it', async () => {
      script([{ event: USAGE }, { hang: true }]);

      const call = track(
        managerWith({ streamFirstEventTimeoutMs: 1000, retryAttemptsLimit: 1 }).addHighPriorityTask(REQUEST, {
          onEvent: sinkReturning(true)
        })
      );
      await vi.advanceTimersByTimeAsync(999);
      expect(call.done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(call.error).toMatchObject({ name: 'StreamIdleTimeoutError', timeoutMs: 1000 });
    });

    it('the first event ends it', async () => {
      script([{ wait: 500 }, { event: DELTA }, { wait: 5000 }]);

      const call = track(
        managerWith({ streamFirstEventTimeoutMs: 1000, streamIdleTimeoutMs: 0 }).addHighPriorityTask(REQUEST, {
          onEvent: sinkReturning(true)
        })
      );
      await vi.advanceTimersByTimeAsync(5500);

      expect(call).toEqual({ done: true, value: 'response' });
    });
  });

  describe('token reservation', () => {
    it('a call aborted while it waits for tokens ends at once, takes nothing and never reaches the provider', async () => {
      // A rate limiter that waits until its signal aborts
      acquire.mockImplementation(
        (_tokens, signal) =>
          new Promise((_resolve, reject) =>
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          )
      );
      const controller = new AbortController();
      const sink = sinkReturning(true);

      const call = track(managerWith().addHighPriorityTask(REQUEST, { signal: controller.signal, onEvent: sink }));
      await vi.advanceTimersByTimeAsync(0);
      expect(acquire).toHaveBeenCalledWith(PREDICTED, controller.signal);
      const reason = new Error('client went away');
      controller.abort(reason);
      await vi.advanceTimersByTimeAsync(0);

      expect(call).toEqual({ done: true, error: reason });
      expect(generate).not.toHaveBeenCalled();
      expect(sink).not.toHaveBeenCalled();
      // Nothing was taken, so nothing is given back
      expect(setUsedTokens).not.toHaveBeenCalled();
      expect(setUsedRequest).not.toHaveBeenCalled();
    });

    it('refund only when no provider event was seen', async () => {
      const error = new TypeError('cannot read the response');

      script([{ fail: error }]);
      const beforeEvent = track(managerWith().addHighPriorityTask(REQUEST, { onEvent: sinkReturning(false) }));
      await vi.advanceTimersByTimeAsync(0);
      expect(beforeEvent).toEqual({ done: true, error });
      // The tokens come back; the request stays spent
      expect(setUsedTokens.mock.calls).toEqual([[-PREDICTED]]);

      setUsedTokens.mockReset();
      script([{ event: ACTIVITY }, { fail: error }]);
      const afterEvent = track(managerWith().addHighPriorityTask(REQUEST, { onEvent: sinkReturning(false) }));
      await vi.advanceTimersByTimeAsync(0);
      expect(afterEvent).toEqual({ done: true, error });
      // The provider had started, so the reservation is kept
      expect(setUsedTokens).not.toHaveBeenCalled();
    });

    it('a retried call keeps the reservation when an earlier attempt saw a provider event', async () => {
      const error = new TypeError('cannot read the response');
      script([{ event: ACTIVITY }, { fail: providerError(503) }], [{ fail: error }]);

      const call = track(managerWith().addHighPriorityTask(REQUEST, { onEvent: sinkReturning(false) }));
      await vi.advanceTimersByTimeAsync(RETRY_WAIT_MS);

      expect(call).toEqual({ done: true, error });
      expect(generate).toHaveBeenCalledTimes(2);
      expect(setUsedTokens).not.toHaveBeenCalled();
    });

    it('reserveTokens false charges the actual usage and a request', async () => {
      script([{ event: DELTA }]);

      const call = track(
        managerWith({ reserveTokens: false }).addHighPriorityTask(REQUEST, { onEvent: sinkReturning(true) })
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(call).toEqual({ done: true, value: 'response' });
      expect(acquire).not.toHaveBeenCalled();
      expect(setUsedTokens.mock.calls).toEqual([[ACTUAL]]);
      expect(setUsedRequest).toHaveBeenCalledTimes(1);

      setUsedTokens.mockReset();
      setUsedRequest.mockReset();
      script([{ event: DELTA }, { fail: new TypeError('cannot read the response') }]);
      const failed = track(
        managerWith({ reserveTokens: false }).addHighPriorityTask(REQUEST, { onEvent: sinkReturning(true) })
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(failed.done).toBe(true);
      expect(setUsedTokens).not.toHaveBeenCalled();
      expect(setUsedRequest).not.toHaveBeenCalled();
    });

    it('a first-event timeout refunds, an idle timeout keeps the reservation', async () => {
      script([{ hang: true }]);
      const silent = track(
        managerWith({ streamFirstEventTimeoutMs: 1000, retryAttemptsLimit: 1 }).addHighPriorityTask(REQUEST, {
          onEvent: sinkReturning(false)
        })
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(silent.error).toBeInstanceOf(StreamIdleTimeoutError);
      expect(setUsedTokens.mock.calls).toEqual([[-PREDICTED]]);

      setUsedTokens.mockReset();
      script([{ event: DELTA }, { hang: true }]);
      const stalled = track(
        managerWith({ streamIdleTimeoutMs: 1000, retryAttemptsLimit: 1 }).addHighPriorityTask(REQUEST, {
          onEvent: sinkReturning(false)
        })
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(stalled.error).toBeInstanceOf(StreamIdleTimeoutError);
      expect(setUsedTokens).not.toHaveBeenCalled();
    });

    it('settles to actual usage after a streamed call', async () => {
      script([{ event: DELTA }]);

      const call = track(managerWith().addHighPriorityTask(REQUEST, { onEvent: sinkReturning(true) }));
      await vi.advanceTimersByTimeAsync(0);

      expect(call.done).toBe(true);
      expect(setUsedTokens.mock.calls).toEqual([[ACTUAL - PREDICTED]]);
    });

    it('a reply whose usage cannot be read resolves and keeps the reservation, or charges only the request', async () => {
      const unreadable = () => {
        throw new TypeError("Cannot read properties of null (reading 'usage')");
      };

      script([{ event: DELTA }]);
      const reserved = track(
        managerWith({}, unreadable).addHighPriorityTask(REQUEST, { onEvent: sinkReturning(true) })
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(reserved).toEqual({ done: true, value: 'response' });
      expect(setUsedTokens).not.toHaveBeenCalled();
      expect(setUsedRequest).not.toHaveBeenCalled();

      script([{ event: DELTA }]);
      const unreserved = track(
        managerWith({ reserveTokens: false }, unreadable).addHighPriorityTask(REQUEST, { onEvent: sinkReturning(true) })
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(unreserved).toEqual({ done: true, value: 'response' });
      expect(setUsedTokens).not.toHaveBeenCalled();
      expect(setUsedRequest).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    ['streamIdleTimeoutMs', -1],
    ['streamIdleTimeoutMs', 1.5],
    ['streamIdleTimeoutMs', Number.NaN],
    ['streamIdleTimeoutMs', Number.POSITIVE_INFINITY],
    ['streamFirstEventTimeoutMs', -1],
    ['streamFirstEventTimeoutMs', 2_147_483_648]
  ])('rejects %s %s', (field, value) => {
    expect(() => managerWith({ [field]: value })).toThrow(RangeError);
  });

  it('accepts timeouts from 0 to the setTimeout limit', () => {
    for (const value of [0, 1, 2_147_483_647]) {
      expect(() => managerWith({ streamIdleTimeoutMs: value, streamFirstEventTimeoutMs: value })).not.toThrow();
    }
  });

  it('no onEvent: no wrapper, no request-start', async () => {
    script([{ hang: true }]);
    const controller = new AbortController();
    const options = { signal: controller.signal };

    const call = track(managerWith({ streamFirstEventTimeoutMs: 1000 }).addHighPriorityTask(REQUEST, options));
    await vi.advanceTimersByTimeAsync(0);

    // The provider gets the caller's own options, and no timer runs
    expect(generate.mock.calls[0][1]).toBe(options);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(call.done).toBe(false);

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(call.error).toMatchObject({ name: 'AbortError' });
  });

  it('no onEvent: a provider timeout is not retried', async () => {
    const error = new StreamIdleTimeoutError();
    script([{ fail: error }], []);

    const call = track(managerWith().addHighPriorityTask(REQUEST));
    await vi.advanceTimersByTimeAsync(0);

    expect(call).toEqual({ done: true, error });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
