import { Interface, Logger, Strategy, StreamIdleTimeoutError } from '@moc-global/loft-definitions';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GenerateCallManager } from '../../GenerateManager';
import { GenerateWithQueueManager } from '../../GenerateWithQueueManager';
import { LlmTokenRateLimiter, LlmTokenRateLimiterConfig } from '../../LlmTokenRateLimiter';
import { GenerateConfig, GenerateWithQueueConfig } from '../../types';

// Scenario tests for streamed calls: concurrency, token reservation, retries and the two stream timeouts, run together
// in randomized batches. Every random choice comes from a seeded generator, so a failing seed reproduces.

type Body = { id: number };
type Reply = { id: number; actual: number };
type Event = Strategy.LLM.LlmStreamEvent;
type Sink = Strategy.LLM.LlmStreamSink;

const DELTA: Event = { type: 'text-delta', delta: 'Hel' };
const ACTIVITY: Event = { type: 'activity' };
const USAGE: Event = { type: 'usage', usage: { inputTokens: 1 } };

const IDLE_MS = 1000;
const FIRST_EVENT_MS = 2000;
const BASE_CONFIG: GenerateConfig = { highPriorityTasksLimit: 1000, retryDelay: 0, retryAttemptsLimit: 3 };

// The estimate and the provider's count of call `id`. Both are unique per call, and so are their difference and the
// refund, so every setUsedTokens value names the call it belongs to.
const predictedOf = (id: number) => 1000 + id;
const actualOf = (id: number) => 5000 + 7 * id;

// What the fake provider does in one attempt
type Step =
  | { event: Event }
  // Waits; an abort ends the wait with the SDK's abort error
  | { wait: number }
  // Waits and does not look at the signal, as a provider that ignores it would
  | { waitIgnoringAbort: number }
  // Waits until aborted
  | { hang: true }
  // Waits until aborted, then sends one more event, as a buffered chunk would, before it rejects
  | { hangThenLateEvent: true }
  // Never ends, whatever the signal does
  | { hangIgnoringAbort: true }
  | { fail: unknown }
  // The caller aborts the call now, or after `ms`
  | { abortCaller: true }
  | { abortCallerAfter: number };

// A provider SDK error: the HTTP status and the response headers
const providerError = (status: number, headers: Record<string, string> = {}) =>
  Object.assign(new Error(`status ${status}`), { status, headers });

// What an SDK rejects with when its signal aborts
const sdkAbortError = () => Object.assign(new Error('Request was aborted.'), { name: 'AbortError' });

function waitOrAbort(ms: number | undefined, signal?: AbortSignal, onAbort?: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      onAbort?.();
      reject(sdkAbortError());
      return;
    }
    const timer = ms === undefined ? undefined : setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        onAbort?.();
        reject(sdkAbortError());
      },
      { once: true }
    );
  });
}

// The settled state of a promise, readable while the fake clock runs
function track<T>(promise: Promise<T>) {
  const state: { done: boolean; value?: T; error?: unknown; at?: number } = { done: false };
  promise.then(
    (value) => Object.assign(state, { done: true, value, at: Date.now() }),
    (error) => Object.assign(state, { done: true, error, at: Date.now() })
  );
  return state;
}

// mulberry32: a small seeded generator, so a failing batch reproduces from its seed
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Random = ReturnType<typeof seeded>;
const intBetween = (random: Random, min: number, max: number) => min + Math.floor(random() * (max - min + 1));
const pick = <T>(random: Random, items: readonly T[]): T => items[Math.floor(random() * items.length)];

const errorName = (error: unknown) => (error instanceof Error || error instanceof DOMException ? error.name : '');

// Reads a private field of the real rate limiter, to check the budget between steps
const budgetOf = (limiter: LlmTokenRateLimiter) =>
  limiter as unknown as { availableTokens: number; availableRequests: number };

/**
 * A rate limiter that records every charge and refund. Without an inner limiter it never waits; with one, it passes
 * every call on.
 */
function recordingLimiter(inner?: LlmTokenRateLimiter, afterAcquire?: () => void) {
  const log: { kind: 'acquire' | 'used' | 'request' | 'await'; tokens: number }[] = [];
  // Tokens taken minus tokens given back, over all calls. A refund larger than the reservation makes it negative.
  let net = 0;
  let lowestNet = 0;
  const book = (tokens: number) => {
    net += tokens;
    lowestNet = Math.min(lowestNet, net);
  };
  const limiter: Strategy.LLM.LlmTokenRateLimiter = {
    async acquire(tokens) {
      await inner?.acquire(tokens);
      log.push({ kind: 'acquire', tokens });
      book(tokens);
      afterAcquire?.();
    },
    async awaitBeforeCall(tokens) {
      log.push({ kind: 'await', tokens: tokens ?? 0 });
      await inner?.awaitBeforeCall(tokens);
    },
    setUsedTokens(tokens) {
      log.push({ kind: 'used', tokens });
      book(tokens);
      inner?.setUsedTokens(tokens);
    },
    setUsedRequest() {
      log.push({ kind: 'request', tokens: 0 });
      inner?.setUsedRequest();
    },
    stop: () => inner?.stop()
  };
  return { limiter, log, lowestNet: () => lowestNet, net: () => net };
}

/** A fake provider that plays a script per call and per attempt, and records what it saw */
function fakeProvider() {
  const scripts = new Map<number, Step[][]>();
  const callers = new Map<number, AbortController>();
  const attemptsOf = new Map<number, number>();
  const startedAt = new Map<number, number[]>();
  const abortedAt = new Map<number, (number | undefined)[]>();
  // What the wrapped sink returned for events sent after the attempt was aborted
  const lateReturns: unknown[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const generate = vi.fn(async (body: Body, options?: Strategy.LLM.CallOptions): Promise<Reply> => {
    const attempt = attemptsOf.get(body.id) ?? 0;
    attemptsOf.set(body.id, attempt + 1);
    const starts = startedAt.get(body.id) ?? [];
    starts.push(Date.now());
    startedAt.set(body.id, starts);
    const aborts = abortedAt.get(body.id) ?? [];
    aborts.push(undefined);
    abortedAt.set(body.id, aborts);
    options?.signal?.addEventListener('abort', () => (aborts[attempt] = Date.now()), { once: true });

    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      for (const step of scripts.get(body.id)?.[attempt] ?? []) {
        if ('event' in step) options?.onEvent?.(step.event);
        else if ('wait' in step) await waitOrAbort(step.wait, options?.signal);
        else if ('waitIgnoringAbort' in step)
          await new Promise((resolve) => setTimeout(resolve, step.waitIgnoringAbort));
        else if ('hang' in step) await waitOrAbort(undefined, options?.signal);
        else if ('hangThenLateEvent' in step)
          await waitOrAbort(undefined, options?.signal, () => lateReturns.push(options?.onEvent?.(DELTA)));
        else if ('hangIgnoringAbort' in step) await new Promise(() => {});
        else if ('abortCaller' in step) callers.get(body.id)?.abort();
        else if ('abortCallerAfter' in step) setTimeout(() => callers.get(body.id)?.abort(), step.abortCallerAfter);
        else throw step.fail;
      }
      return { id: body.id, actual: actualOf(body.id) };
    } finally {
      inFlight--;
    }
  });

  return {
    generate,
    scripts,
    callers,
    attempts: (id: number) => attemptsOf.get(id) ?? 0,
    startedAt: (id: number) => startedAt.get(id) ?? [],
    abortedAt: (id: number) => abortedAt.get(id) ?? [],
    lateReturns,
    maxInFlight: () => maxInFlight,
    inFlight: () => inFlight
  };
}

function llmApi(provider: ReturnType<typeof fakeProvider>, tokenRateLimiter: Strategy.LLM.LlmTokenRateLimiter) {
  return {
    generate: provider.generate,
    reduceMessages: (body: Body) => String(body.id),
    extractUsedTokens: (reply: Reply) => reply.actual,
    tokenRateLimiter,
    llmTokenizer: { calculateTokensFromString: (text: string) => predictedOf(Number(text)) }
  } as unknown as Strategy.LLM.LLMApi;
}

const requestFor = (id: number): Strategy.LLM.LLMRequest<Body> => ({
  sessionId: `session-${id}`,
  requestType: Strategy.LLM.LLMRequestType.GENERATE,
  llmName: 'fake',
  llmBody: { id },
  priority: 30
});

// A consumer that answers `delivered` for every event, request-start included, and records what it got
function consumer(delivered: boolean) {
  const events: Event[] = [];
  const sink = vi.fn<Sink>((event) => {
    events.push(event);
    return delivered;
  });
  return { sink, types: () => events.map((event) => event.type) };
}

// Runs the fake clock until every call settled, or the bound passed
async function settleAll(states: { done: boolean }[], boundMs = 30 * 60_000, stepMs = 250) {
  for (let elapsed = 0; elapsed < boundMs && states.some((state) => !state.done); elapsed += stepMs) {
    await vi.advanceTimersByTimeAsync(stepMs);
  }
}

// The event types a consumer gets from one attempt: request-start, then the provider's events until the attempt ends
function expectedTypes(steps: Step[]): string[] {
  const types = ['request-start'];
  for (const step of steps) {
    if ('event' in step) types.push(step.event.type);
    else if ('wait' in step || 'waitIgnoringAbort' in step || 'abortCallerAfter' in step) continue;
    else break;
  }
  return types;
}

describe('streamed call scenarios', () => {
  const unhandled = vi.fn();

  beforeAll(() => {
    Logger.configure({ logLevel: Interface.LogLevel.NONE });
  });

  beforeEach(() => {
    unhandled.mockReset();
    process.on('unhandledRejection', unhandled);
  });

  afterEach(() => {
    process.off('unhandledRejection', unhandled);
    vi.useRealTimers();
  });

  // Unhandled rejections are reported on a later turn of the event loop
  const expectNoUnhandledRejection = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    expect(unhandled).not.toHaveBeenCalled();
  };

  describe('mixed batches', () => {
    type Ledger = 'settle' | 'refund' | 'keep' | 'none';
    type Outcome = 'ok' | 'timeout' | 'abort' | { status: number };
    interface Scenario {
      kind: string;
      attempts: Step[][];
      streamed: boolean;
      delivered: boolean;
      preAborted?: boolean;
      outcome: Outcome;
      ledger: Ledger;
    }

    const gap = (random: Random) => intBetween(random, 1, IDLE_MS - 1);
    const repeat = (times: number, steps: () => Step[]) => Array.from({ length: times }, steps);

    // Each kind, its provider script and what it must end with
    const KINDS: Record<string, (random: Random) => Omit<Scenario, 'kind'>> = {
      'streams and succeeds': (random) => ({
        attempts: [
          [{ event: DELTA }, { wait: gap(random) }, { event: DELTA }, { wait: gap(random) }, { event: USAGE }]
        ],
        streamed: true,
        delivered: random() < 0.5,
        outcome: 'ok',
        ledger: 'settle'
      }),
      'fails before any event, then succeeds': (random) => ({
        attempts: [[{ fail: providerError(503) }], [{ event: DELTA }]],
        streamed: true,
        delivered: random() < 0.5,
        outcome: 'ok',
        ledger: 'settle'
      }),
      'fails after an event that was kept back, then succeeds': () => ({
        attempts: [[{ event: DELTA }, { fail: providerError(503) }], [{ event: DELTA }]],
        streamed: true,
        delivered: false,
        outcome: 'ok',
        ledger: 'settle'
      }),
      'fails with a 400 before any event': (random) => ({
        attempts: [[{ fail: providerError(400) }]],
        streamed: true,
        delivered: random() < 0.5,
        outcome: { status: 400 },
        ledger: 'refund'
      }),
      'fails with 503 before any event in every attempt': (random) => ({
        attempts: repeat(3, () => [{ fail: providerError(503) }]),
        streamed: true,
        delivered: random() < 0.5,
        outcome: { status: 503 },
        ledger: 'refund'
      }),
      'fails with 503 after a delivered delta': () => ({
        attempts: [[{ event: DELTA }, { fail: providerError(503) }]],
        streamed: true,
        delivered: true,
        outcome: { status: 503 },
        ledger: 'keep'
      }),
      'fails with a 400 after activity': (random) => ({
        attempts: [[{ event: ACTIVITY }, { fail: providerError(400) }]],
        streamed: true,
        delivered: random() < 0.5,
        outcome: { status: 400 },
        ledger: 'keep'
      }),
      'fails with 503 after kept-back events in every attempt': () => ({
        attempts: repeat(3, () => [{ event: DELTA }, { fail: providerError(503) }]),
        streamed: true,
        delivered: false,
        outcome: { status: 503 },
        ledger: 'keep'
      }),
      'sends activity once, then fails silently in later attempts': () => ({
        attempts: [
          [{ event: ACTIVITY }, { fail: providerError(503) }],
          [{ fail: providerError(503) }],
          [{ fail: providerError(503) }]
        ],
        streamed: true,
        delivered: false,
        outcome: { status: 503 },
        ledger: 'keep'
      }),
      'stalls after a delivered delta': (random) => ({
        attempts: [[{ event: DELTA }, { wait: gap(random) }, { event: DELTA }, { hangThenLateEvent: true }]],
        streamed: true,
        delivered: true,
        outcome: 'timeout',
        ledger: 'keep'
      }),
      'stalls after kept-back deltas in every attempt': (random) => ({
        attempts: repeat(3, () => [{ event: DELTA }, { wait: gap(random) }, { hangThenLateEvent: true }]),
        streamed: true,
        delivered: false,
        outcome: 'timeout',
        ledger: 'keep'
      }),
      'never sends a first event': (random) => ({
        attempts: repeat(3, () => [{ hang: true }]),
        streamed: true,
        delivered: random() < 0.5,
        outcome: 'timeout',
        ledger: 'refund'
      }),
      'never sends a first event, then succeeds': (random) => ({
        attempts: [[{ hang: true }], [{ wait: gap(random) }, { event: DELTA }]],
        streamed: true,
        delivered: random() < 0.5,
        outcome: 'ok',
        ledger: 'settle'
      }),
      'answers without streaming, in time': (random) => ({
        attempts: [[{ wait: intBetween(random, 1, FIRST_EVENT_MS - 1) }]],
        streamed: true,
        delivered: random() < 0.5,
        outcome: 'ok',
        ledger: 'settle'
      }),
      'answers without streaming, too late': (random) => ({
        attempts: repeat(3, () => [{ wait: FIRST_EVENT_MS + intBetween(random, 1, 5000) }]),
        streamed: true,
        delivered: random() < 0.5,
        outcome: 'timeout',
        ledger: 'refund'
      }),
      'caller aborts during the stream': (random) => ({
        attempts: [[{ event: DELTA }, { wait: gap(random) }, { abortCaller: true }, { hangThenLateEvent: true }]],
        streamed: true,
        delivered: random() < 0.5,
        outcome: 'abort',
        ledger: 'keep'
      }),
      'caller aborts before the first event': (random) => ({
        attempts: [[{ abortCallerAfter: intBetween(random, 1, FIRST_EVENT_MS - 1) }, { hang: true }]],
        streamed: true,
        delivered: random() < 0.5,
        outcome: 'abort',
        ledger: 'keep'
      }),
      'caller aborts during the retry wait': (random) => ({
        attempts: [
          [
            { abortCallerAfter: intBetween(random, 1, 4999) },
            { fail: providerError(503, { 'retry-after-ms': '5000' }) }
          ]
        ],
        streamed: true,
        delivered: random() < 0.5,
        outcome: 'abort',
        ledger: 'keep'
      }),
      'caller aborted before the call': (random) => ({
        attempts: [],
        streamed: random() < 0.5,
        delivered: random() < 0.5,
        preAborted: true,
        outcome: 'abort',
        ledger: 'none'
      }),
      'is not streamed and succeeds': (random) => ({
        attempts: [[{ wait: intBetween(random, 1, 10_000) }]],
        streamed: false,
        delivered: false,
        outcome: 'ok',
        ledger: 'settle'
      }),
      'is not streamed and fails with 503 in every attempt': () => ({
        attempts: repeat(3, () => [{ fail: providerError(503) }]),
        streamed: false,
        delivered: false,
        outcome: { status: 503 },
        ledger: 'refund'
      }),
      'is not streamed and the caller aborts': () => ({
        attempts: [[{ abortCaller: true }, { hang: true }]],
        streamed: false,
        delivered: false,
        outcome: 'abort',
        ledger: 'keep'
      })
    };

    function scenariosFor(seed: number, count: number): Scenario[] {
      const random = seeded(seed);
      const kinds = Object.keys(KINDS);
      return Array.from({ length: count }, () => {
        const kind = pick(random, kinds);
        return { kind, ...KINDS[kind](random) };
      });
    }

    const attemptCount = (scenario: Scenario) => (scenario.preAborted ? 0 : scenario.attempts.length);

    const BATCHES = [1, 2, 4].flatMap((concurrency) =>
      Array.from({ length: 8 }, (_, index) => ({ concurrency, seed: concurrency * 100 + index }))
    );

    it.each(BATCHES)(
      'concurrency $concurrency, seed $seed: every call ends as its script says',
      async ({ concurrency, seed }) => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        const scenarios = scenariosFor(seed, 16);
        const provider = fakeProvider();
        const recording = recordingLimiter();
        const manager = new GenerateCallManager<Body, Reply>(
          'scenario',
          { ...BASE_CONFIG, concurrency, streamIdleTimeoutMs: IDLE_MS, streamFirstEventTimeoutMs: FIRST_EVENT_MS },
          llmApi(provider, recording.limiter)
        );

        const runs = scenarios.map((scenario, id) => {
          provider.scripts.set(id, scenario.attempts);
          const controller = new AbortController();
          provider.callers.set(id, controller);
          if (scenario.preAborted) controller.abort();
          const sink = consumer(scenario.delivered);
          const options = { signal: controller.signal, ...(scenario.streamed ? { onEvent: sink.sink } : {}) };
          return { id, scenario, sink, state: track(manager.addHighPriorityTask(requestFor(id), options)) };
        });
        await settleAll(runs.map((run) => run.state));

        for (const { id, scenario, sink, state } of runs) {
          const label = `seed ${seed}, call ${id}: ${scenario.kind}`;
          expect(state.done, label).toBe(true);

          // Result
          if (scenario.outcome === 'ok') {
            expect(state.error, label).toBeUndefined();
            expect(state.value, label).toEqual({ id, actual: actualOf(id) });
          } else if (scenario.outcome === 'timeout') {
            expect(state.error, label).toBeInstanceOf(StreamIdleTimeoutError);
          } else if (scenario.outcome === 'abort') {
            expect(errorName(state.error), label).toBe('AbortError');
          } else {
            expect(state.error, label).toMatchObject({ status: scenario.outcome.status });
          }

          // Attempts, and what the consumer was shown in each
          expect(provider.attempts(id), label).toBe(attemptCount(scenario));
          const shown = scenario.streamed ? scenario.attempts.flatMap(expectedTypes) : [];
          expect(sink.types(), label).toEqual(shown);

          // Tokens: one reservation per started call, settled, refunded or kept
          const predicted = predictedOf(id);
          const acquired = recording.log.filter((entry) => entry.kind === 'acquire' && entry.tokens === predicted);
          const used = recording.log.filter(
            (entry) =>
              entry.kind === 'used' && (entry.tokens === actualOf(id) - predicted || entry.tokens === -predicted)
          );
          expect(acquired, label).toHaveLength(scenario.ledger === 'none' ? 0 : 1);
          const expectedUsed = {
            settle: [actualOf(id) - predicted],
            refund: [-predicted],
            keep: [],
            none: []
          }[scenario.ledger];
          expect(
            used.map((entry) => entry.tokens),
            label
          ).toEqual(expectedUsed);
        }

        // Totals: the request is part of the reservation, the budget is only ever checked through acquire, and no
        // refund ever gave back more than was taken
        expect(recording.log.filter((entry) => entry.kind === 'request')).toHaveLength(0);
        expect(recording.log.filter((entry) => entry.kind === 'await')).toHaveLength(0);
        expect(recording.lowestNet()).toBeGreaterThanOrEqual(0);
        const expectedNet = runs.reduce((sum, { id, scenario }) => {
          if (scenario.ledger === 'settle') return sum + actualOf(id);
          if (scenario.ledger === 'keep') return sum + predictedOf(id);
          return sum;
        }, 0);
        expect(recording.net()).toBe(expectedNet);

        // Never more calls at the provider than the concurrency
        expect(provider.maxInFlight()).toBeLessThanOrEqual(concurrency);
        // Events sent after an attempt was aborted were never passed on
        expect(provider.lateReturns.every((returned) => returned === false)).toBe(true);
        // Nothing is left running
        expect(vi.getTimerCount()).toBe(0);
        await expectNoUnhandledRejection();
      }
    );
  });

  describe('idle timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    });

    const SEEDS = Array.from({ length: 12 }, (_, index) => 7000 + index);

    it.each(SEEDS)('fires one idle period after the last chunk, at a random chunk (seed %i)', async (seed) => {
      const random = seeded(seed);
      const chunks = intBetween(random, 1, 6);
      // No timer runs before the first event, so the first wait may be far longer than the idle timeout
      const steps: Step[] = [{ wait: intBetween(random, 0, 3 * IDLE_MS) }, { event: DELTA }];
      let lastEventAt = (steps[0] as { wait: number }).wait;
      for (let chunk = 1; chunk < chunks; chunk++) {
        const wait = intBetween(random, 1, IDLE_MS - 1);
        lastEventAt += wait;
        steps.push({ wait }, { event: pick(random, [DELTA, ACTIVITY, USAGE]) });
      }
      steps.push({ hang: true });
      const delivered = random() < 0.5;

      const provider = fakeProvider();
      provider.scripts.set(0, [steps, steps]);
      const recording = recordingLimiter();
      const manager = new GenerateCallManager<Body, Reply>(
        'scenario',
        { ...BASE_CONFIG, retryAttemptsLimit: 2, streamIdleTimeoutMs: IDLE_MS },
        llmApi(provider, recording.limiter)
      );
      const sink = consumer(delivered);
      const call = track(manager.addHighPriorityTask(requestFor(0), { onEvent: sink.sink }));
      await settleAll([call]);

      const label = `seed ${seed}, ${chunks} chunks, delivered ${delivered}`;
      expect(call.error, label).toBeInstanceOf(StreamIdleTimeoutError);
      expect(call.error, label).toMatchObject({ timeoutMs: IDLE_MS });
      // A delivered chunk stops retries; kept-back chunks do not
      expect(provider.attempts(0), label).toBe(delivered ? 1 : 2);
      provider.startedAt(0).forEach((startedAt, attempt) => {
        expect((provider.abortedAt(0)[attempt] ?? Number.NaN) - startedAt, label).toBe(lastEventAt + IDLE_MS);
      });
      // The provider had sent events, so the reservation is kept
      expect(recording.log.filter((entry) => entry.kind === 'used')).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('random gaps: the call fails exactly when a gap after the first event reaches the timeout', async () => {
      for (let seed = 1; seed <= 60; seed++) {
        const random = seeded(seed);
        const gaps = Array.from({ length: intBetween(random, 1, 8) }, () => {
          let wait = intBetween(random, 1, 2 * IDLE_MS);
          while (wait === IDLE_MS) wait = intBetween(random, 1, 2 * IDLE_MS);
          return wait;
        });
        const steps: Step[] = [{ event: DELTA }];
        gaps.forEach((wait) => steps.push({ wait }, { event: DELTA }));

        const provider = fakeProvider();
        provider.scripts.set(0, [steps]);
        const manager = new GenerateCallManager<Body, Reply>(
          'scenario',
          { ...BASE_CONFIG, retryAttemptsLimit: 1, streamIdleTimeoutMs: IDLE_MS },
          llmApi(provider, recordingLimiter().limiter)
        );
        const sink = consumer(true);
        const startedAt = Date.now();
        const call = track(manager.addHighPriorityTask(requestFor(0), { onEvent: sink.sink }));
        await settleAll([call]);

        const label = `seed ${seed}, gaps ${gaps.join(',')}`;
        const tooLong = gaps.findIndex((wait) => wait > IDLE_MS);
        if (tooLong === -1) {
          expect(call.error, label).toBeUndefined();
          expect(
            sink.types().filter((type) => type === 'text-delta'),
            label
          ).toHaveLength(gaps.length + 1);
        } else {
          const lastEventAt = gaps.slice(0, tooLong).reduce((sum, wait) => sum + wait, 0);
          expect(call.error, label).toBeInstanceOf(StreamIdleTimeoutError);
          expect((call.at ?? Number.NaN) - startedAt, label).toBe(lastEventAt + IDLE_MS);
          expect(
            sink.types().filter((type) => type === 'text-delta'),
            label
          ).toHaveLength(tooLong + 1);
        }
        expect(vi.getTimerCount(), label).toBe(0);
      }
    });

    it('an event exactly one idle period after the last one is too late', async () => {
      const provider = fakeProvider();
      provider.scripts.set(0, [[{ event: DELTA }, { wait: IDLE_MS }, { event: DELTA }]]);
      const manager = new GenerateCallManager<Body, Reply>(
        'scenario',
        { ...BASE_CONFIG, retryAttemptsLimit: 1, streamIdleTimeoutMs: IDLE_MS },
        llmApi(provider, recordingLimiter().limiter)
      );

      const call = track(manager.addHighPriorityTask(requestFor(0), { onEvent: consumer(true).sink }));
      await settleAll([call]);

      expect(call.error).toBeInstanceOf(StreamIdleTimeoutError);
    });

    it('an event from an earlier attempt neither reaches the consumer nor holds off the next attempt timeout', async () => {
      let staleSink: Sink | undefined;
      const staleReturns: unknown[] = [];
      const provider = fakeProvider();
      provider.generate.mockImplementationOnce(async (_body, options) => {
        staleSink = options?.onEvent;
        throw providerError(503);
      });
      // The first attempt bypasses the script, so the script's first entry is the second attempt, which stays silent
      provider.scripts.set(0, [[{ hang: true }]]);
      const manager = new GenerateCallManager<Body, Reply>(
        'scenario',
        { ...BASE_CONFIG, retryAttemptsLimit: 2, streamFirstEventTimeoutMs: FIRST_EVENT_MS },
        llmApi(provider, recordingLimiter().limiter)
      );
      const sink = consumer(true);

      const call = track(manager.addHighPriorityTask(requestFor(0), { onEvent: sink.sink }));
      await vi.advanceTimersByTimeAsync(FIRST_EVENT_MS / 2);
      staleReturns.push(staleSink?.(DELTA));
      await settleAll([call]);

      expect(staleReturns).toEqual([false]);
      expect(sink.types()).toEqual(['request-start', 'request-start']);
      expect(call.error).toBeInstanceOf(StreamIdleTimeoutError);
    });
  });

  describe('first-event timeout and providers that do not stream', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    });

    it.each([
      { responseMs: 500, timeoutMs: 1000, outcome: 'ok', attempts: 1 },
      { responseMs: 999, timeoutMs: 1000, outcome: 'ok', attempts: 1 },
      { responseMs: 1001, timeoutMs: 1000, outcome: 'timeout', attempts: 3 },
      { responseMs: 60_000, timeoutMs: 1000, outcome: 'timeout', attempts: 3 },
      { responseMs: 60_000, timeoutMs: 0, outcome: 'ok', attempts: 1 },
      // Unset, it is 10 minutes
      { responseMs: 599_999, timeoutMs: undefined, outcome: 'ok', attempts: 1 }
    ])(
      'a provider that ignores onEvent and answers after $responseMs ms, timeout $timeoutMs: $outcome',
      async ({ responseMs, timeoutMs, outcome, attempts }) => {
        const provider = fakeProvider();
        provider.scripts.set(
          0,
          Array.from({ length: 3 }, () => [{ wait: responseMs }])
        );
        const recording = recordingLimiter();
        const manager = new GenerateCallManager<Body, Reply>(
          'scenario',
          { ...BASE_CONFIG, streamFirstEventTimeoutMs: timeoutMs, streamIdleTimeoutMs: 100 },
          llmApi(provider, recording.limiter)
        );
        const sink = consumer(true);

        const call = track(manager.addHighPriorityTask(requestFor(0), { onEvent: sink.sink }));
        await settleAll([call]);

        expect(provider.attempts(0)).toBe(attempts);
        expect(sink.types()).toEqual(Array.from({ length: attempts }, () => 'request-start'));
        if (outcome === 'ok') {
          expect(call.value).toEqual({ id: 0, actual: actualOf(0) });
          expect(recording.log.filter((entry) => entry.kind === 'used').map((entry) => entry.tokens)).toEqual([
            actualOf(0) - predictedOf(0)
          ]);
        } else {
          expect(call.error).toMatchObject({ name: 'StreamIdleTimeoutError', timeoutMs });
          // The provider never sent an event, so the tokens come back
          expect(recording.log.filter((entry) => entry.kind === 'used').map((entry) => entry.tokens)).toEqual([
            -predictedOf(0)
          ]);
        }
        expect(vi.getTimerCount()).toBe(0);
      }
    );

    it('does not count the wait in the call queue', async () => {
      const provider = fakeProvider();
      const busy: Step[] = [];
      for (let index = 0; index < 15; index++) busy.push({ event: DELTA }, { wait: 200 });
      provider.scripts.set(0, [busy]);
      provider.scripts.set(1, [[{ wait: 300 }, { event: DELTA }]]);
      const manager = new GenerateCallManager<Body, Reply>(
        'scenario',
        { ...BASE_CONFIG, streamFirstEventTimeoutMs: 1000, streamIdleTimeoutMs: IDLE_MS },
        llmApi(provider, recordingLimiter().limiter)
      );

      const first = track(manager.addHighPriorityTask(requestFor(0), { onEvent: consumer(true).sink }));
      const queued = track(manager.addHighPriorityTask(requestFor(1), { onEvent: consumer(true).sink }));
      await settleAll([first, queued]);

      expect(first.error).toBeUndefined();
      expect(queued.error).toBeUndefined();
      expect(provider.attempts(1)).toBe(1);
      // The queued call started only once the first one ended, three seconds in
      expect(provider.startedAt(1)[0] - provider.startedAt(0)[0]).toBe(3000);
    });

    // The timeout ends the attempt itself, so a provider that never settles cannot hold the call
    it('ends the call at the timeout even when the provider ignores the abort', async () => {
      const provider = fakeProvider();
      provider.scripts.set(0, [[{ hangIgnoringAbort: true }]]);
      const manager = new GenerateCallManager<Body, Reply>(
        'scenario',
        { ...BASE_CONFIG, retryAttemptsLimit: 1, streamFirstEventTimeoutMs: 1000 },
        llmApi(provider, recordingLimiter().limiter)
      );

      const call = track(manager.addHighPriorityTask(requestFor(0), { onEvent: consumer(true).sink }));
      await vi.advanceTimersByTimeAsync(1000);

      expect(provider.abortedAt(0)[0]).toBe(provider.startedAt(0)[0] + 1000);
      expect(call.done).toBe(true);
      expect(call.error).toBeInstanceOf(StreamIdleTimeoutError);
    });

    it('a provider that ignores the abort but answers later: the call ends at the timeout and drops the answer', async () => {
      const provider = fakeProvider();
      provider.scripts.set(0, [[{ event: DELTA }, { waitIgnoringAbort: 3000 }, { event: DELTA }]]);
      const recording = recordingLimiter();
      const manager = new GenerateCallManager<Body, Reply>(
        'scenario',
        { ...BASE_CONFIG, retryAttemptsLimit: 1, streamIdleTimeoutMs: IDLE_MS },
        llmApi(provider, recording.limiter)
      );
      const sink = consumer(true);

      const startedAt = Date.now();
      const call = track(manager.addHighPriorityTask(requestFor(0), { onEvent: sink.sink }));
      await settleAll([call]);

      expect(call.error).toBeInstanceOf(StreamIdleTimeoutError);
      expect((call.at ?? Number.NaN) - startedAt).toBe(IDLE_MS);
      // The provider answers later; its last delta and its result reach no one
      await vi.advanceTimersByTimeAsync(5000);
      expect(provider.inFlight()).toBe(0);
      expect(sink.types()).toEqual(['request-start', 'text-delta']);
      // The provider had sent an event, so the reservation is kept
      expect(recording.log.filter((entry) => entry.kind === 'used')).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
      await expectNoUnhandledRejection();
    });
  });

  describe('caller aborts', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    });

    it('during the retry wait: ends at once with the reason, keeps the reservation and leaves no timer', async () => {
      const provider = fakeProvider();
      provider.scripts.set(0, [[{ fail: providerError(503, { 'retry-after-ms': '30000' }) }], [{ event: DELTA }]]);
      const recording = recordingLimiter();
      const manager = new GenerateCallManager<Body, Reply>(
        'scenario',
        { ...BASE_CONFIG, streamIdleTimeoutMs: IDLE_MS, streamFirstEventTimeoutMs: FIRST_EVENT_MS },
        llmApi(provider, recording.limiter)
      );
      const controller = new AbortController();
      const sink = consumer(true);

      const call = track(manager.addHighPriorityTask(requestFor(0), { signal: controller.signal, onEvent: sink.sink }));
      await vi.advanceTimersByTimeAsync(10_000);
      // Only the retry wait runs: neither stream timer runs while the call waits to retry
      expect(vi.getTimerCount()).toBe(1);
      const reason = new Error('client went away');
      controller.abort(reason);
      await vi.advanceTimersByTimeAsync(0);

      expect(call).toMatchObject({ done: true, error: reason });
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(provider.attempts(0)).toBe(1);
      expect(sink.types()).toEqual(['request-start']);
      expect(recording.log.map((entry) => entry.kind)).toEqual(['acquire']);
      await expectNoUnhandledRejection();
    });

    it('while queued: never takes tokens and frees nothing it did not hold', async () => {
      const provider = fakeProvider();
      provider.scripts.set(0, [[{ event: DELTA }, { wait: 500 }, { event: DELTA }]]);
      provider.scripts.set(2, [[{ event: DELTA }]]);
      const recording = recordingLimiter();
      const manager = new GenerateCallManager<Body, Reply>(
        'scenario',
        { ...BASE_CONFIG, streamIdleTimeoutMs: IDLE_MS },
        llmApi(provider, recording.limiter)
      );
      const controller = new AbortController();

      const running = track(manager.addHighPriorityTask(requestFor(0), { onEvent: consumer(true).sink }));
      const aborted = track(
        manager.addHighPriorityTask(requestFor(1), { signal: controller.signal, onEvent: consumer(true).sink })
      );
      const next = track(manager.addHighPriorityTask(requestFor(2), { onEvent: consumer(true).sink }));
      await vi.advanceTimersByTimeAsync(100);
      controller.abort();
      await settleAll([running, aborted, next]);

      expect(errorName(aborted.error)).toBe('AbortError');
      expect(provider.attempts(1)).toBe(0);
      // The running call still held the only slot, so the next one started after it
      expect(provider.maxInFlight()).toBe(1);
      expect(next.value).toEqual({ id: 2, actual: actualOf(2) });
      expect(recording.log.filter((entry) => entry.kind === 'acquire').map((entry) => entry.tokens)).toEqual([
        predictedOf(0),
        predictedOf(2)
      ]);
    });

    it('one call aborting does not disturb the others running beside it', async () => {
      const provider = fakeProvider();
      for (const id of [0, 1, 2]) provider.scripts.set(id, [[{ event: DELTA }, { wait: 800 }, { event: DELTA }]]);
      provider.scripts.set(1, [[{ event: DELTA }, { wait: 100 }, { abortCaller: true }, { hang: true }]]);
      const manager = new GenerateCallManager<Body, Reply>(
        'scenario',
        { ...BASE_CONFIG, concurrency: 3, streamIdleTimeoutMs: IDLE_MS },
        llmApi(provider, recordingLimiter().limiter)
      );

      const runs = [0, 1, 2].map((id) => {
        const controller = new AbortController();
        provider.callers.set(id, controller);
        return track(
          manager.addHighPriorityTask(requestFor(id), { signal: controller.signal, onEvent: consumer(true).sink })
        );
      });
      await settleAll(runs);

      expect(runs[0].value).toEqual({ id: 0, actual: actualOf(0) });
      expect(errorName(runs[1].error)).toBe('AbortError');
      expect(runs[2].value).toEqual({ id: 2, actual: actualOf(2) });
      expect(provider.abortedAt(0)).toEqual([undefined]);
      expect(provider.abortedAt(2)).toEqual([undefined]);
    });
  });

  describe('with the real rate limiter', () => {
    const limiters: LlmTokenRateLimiter[] = [];
    const PREDICTED = 100;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    });

    afterEach(() => {
      limiters.splice(0).forEach((limiter) => limiter.stop());
    });

    function realLimiter(config: Partial<LlmTokenRateLimiterConfig> = {}) {
      const limiter = new LlmTokenRateLimiter({
        newTokensPerSecond: PREDICTED,
        newRequestsPerSecond: 100,
        maxTokens: PREDICTED,
        maxRequests: 100,
        maxAwaitSeconds: 60,
        ...config
      });
      limiters.push(limiter);
      return limiter;
    }

    // A fixed estimate for every call, whatever its id, and a provider count equal to it
    function fixedApi(provider: ReturnType<typeof fakeProvider>, limiter: Strategy.LLM.LlmTokenRateLimiter) {
      return {
        ...llmApi(provider, limiter),
        extractUsedTokens: () => PREDICTED,
        llmTokenizer: { calculateTokensFromString: () => PREDICTED }
      } as unknown as Strategy.LLM.LLMApi;
    }

    const STREAM: Step[] = [{ event: DELTA }, { wait: 50 }, { event: DELTA }, { wait: 50 }, { event: USAGE }];

    it.each([
      { concurrency: 1, budgetFor: 1 },
      { concurrency: 1, budgetFor: 3 },
      { concurrency: 2, budgetFor: 1 },
      { concurrency: 2, budgetFor: 3 },
      { concurrency: 4, budgetFor: 2 },
      { concurrency: 4, budgetFor: 3 },
      { concurrency: 4, budgetFor: 6 }
    ])(
      'concurrency $concurrency, a budget for $budgetFor calls: at most the smaller number run at once',
      async ({ concurrency, budgetFor }) => {
        const limiter = realLimiter({ maxTokens: budgetFor * PREDICTED });
        const lowestAfterAcquire: number[] = [];
        const recording = recordingLimiter(limiter, () => lowestAfterAcquire.push(budgetOf(limiter).availableTokens));
        const provider = fakeProvider();
        const calls = 6;
        for (let id = 0; id < calls; id++) provider.scripts.set(id, [STREAM]);
        const manager = new GenerateCallManager<Body, Reply>(
          'scenario',
          { ...BASE_CONFIG, concurrency, streamIdleTimeoutMs: IDLE_MS, streamFirstEventTimeoutMs: FIRST_EVENT_MS },
          fixedApi(provider, recording.limiter)
        );

        const runs = Array.from({ length: calls }, (_, id) =>
          track(manager.addHighPriorityTask(requestFor(id), { onEvent: consumer(true).sink }))
        );
        await settleAll(runs, 10 * 60_000, 50);

        expect(runs.every((run) => run.error === undefined)).toBe(true);
        expect(provider.maxInFlight()).toBe(Math.min(concurrency, budgetFor));
        // Each call took its tokens from a budget that held them
        expect(Math.min(...lowestAfterAcquire)).toBeGreaterThanOrEqual(0);
        expect(recording.lowestNet()).toBeGreaterThanOrEqual(0);
        // Waits for the limiter never count toward the first-event timeout
        expect(runs.map((_, id) => provider.attempts(id))).toEqual(runs.map(() => 1));
        limiter.stop();
        expect(vi.getTimerCount()).toBe(0);
      }
    );

    it('two models sharing one budget never run more calls together than it holds', async () => {
      const limiter = realLimiter({ maxTokens: 3 * PREDICTED });
      const provider = fakeProvider();
      for (let id = 0; id < 8; id++) provider.scripts.set(id, [STREAM]);
      const config = { ...BASE_CONFIG, concurrency: 2, streamIdleTimeoutMs: IDLE_MS };
      const first = new GenerateCallManager<Body, Reply>('first', config, fixedApi(provider, limiter));
      const second = new GenerateCallManager<Body, Reply>('second', config, fixedApi(provider, limiter));

      const runs = Array.from({ length: 8 }, (_, id) =>
        track((id % 2 ? first : second).addHighPriorityTask(requestFor(id), { onEvent: consumer(true).sink }))
      );
      await settleAll(runs, 10 * 60_000, 50);

      expect(runs.every((run) => run.error === undefined)).toBe(true);
      expect(provider.maxInFlight()).toBe(3);
    });

    it('a call estimated above the whole budget waits for a full budget and leaves it below zero', async () => {
      const limiter = realLimiter({ maxTokens: 1000, newTokensPerSecond: 1000 });
      const provider = fakeProvider();
      provider.scripts.set(0, [[{ event: DELTA }, { wait: 100 }, { event: DELTA }]]);
      provider.scripts.set(1, [[{ event: DELTA }]]);
      const sizes = [1500, 300];
      const api = {
        ...llmApi(provider, limiter),
        extractUsedTokens: (reply: Reply) => sizes[reply.id],
        llmTokenizer: { calculateTokensFromString: (text: string) => sizes[Number(text)] }
      } as unknown as Strategy.LLM.LLMApi;
      const manager = new GenerateCallManager<Body, Reply>(
        'scenario',
        { ...BASE_CONFIG, concurrency: 2, streamIdleTimeoutMs: IDLE_MS },
        api
      );

      const startedAt = Date.now();
      const oversized = track(manager.addHighPriorityTask(requestFor(0), { onEvent: consumer(true).sink }));
      await vi.advanceTimersByTimeAsync(0);
      // The documented oversized case: the whole estimate is taken from a full budget
      expect(budgetOf(limiter).availableTokens).toBe(-500);
      const normal = track(manager.addHighPriorityTask(requestFor(1), { onEvent: consumer(true).sink }));
      await settleAll([oversized, normal], 60_000, 10);

      expect(oversized.error).toBeUndefined();
      expect(normal.error).toBeUndefined();
      // The normal call waited for 800 tokens to refill
      expect(provider.startedAt(1)[0] - startedAt).toBeGreaterThanOrEqual(800);
      expect(provider.startedAt(1)[0] - startedAt).toBeLessThan(900);
    });

    it('counts one request per call, however many attempts it makes', async () => {
      const calls = 4;
      // No request refill: a call that took a request per attempt would run out and wait in vain
      const limiter = realLimiter({
        maxTokens: 100 * PREDICTED,
        maxRequests: calls,
        newRequestsPerSecond: 0,
        maxAwaitSeconds: 5
      });
      const provider = fakeProvider();
      for (let id = 0; id < calls; id++) {
        provider.scripts.set(id, [
          [{ fail: providerError(503) }],
          [{ event: ACTIVITY }, { fail: providerError(529) }],
          [STREAM[0]]
        ]);
      }
      provider.scripts.set(1, [[{ fail: providerError(503) }], [{ fail: providerError(503) }], [STREAM[0]]]);
      const manager = new GenerateCallManager<Body, Reply>(
        'scenario',
        { ...BASE_CONFIG, concurrency: 2, streamIdleTimeoutMs: IDLE_MS },
        fixedApi(provider, limiter)
      );

      const runs = Array.from({ length: calls }, (_, id) =>
        track(manager.addHighPriorityTask(requestFor(id), { onEvent: consumer(false).sink }))
      );
      await settleAll(runs, 60_000, 50);

      expect(runs.map((run) => run.error)).toEqual([undefined, undefined, undefined, undefined]);
      expect(budgetOf(limiter).availableRequests).toBe(0);
    });

    it('a limiter that ignores the abort signal: a call aborted while it waits keeps its reservation and never reaches the provider', async () => {
      const limiter = realLimiter();
      const recording = recordingLimiter(limiter);
      const provider = fakeProvider();
      provider.scripts.set(0, [[{ event: DELTA }, { wait: 3000 }, { event: DELTA }]]);
      const manager = new GenerateCallManager<Body, Reply>(
        'scenario',
        { ...BASE_CONFIG, concurrency: 2, streamIdleTimeoutMs: 0 },
        fixedApi(provider, recording.limiter)
      );
      const controller = new AbortController();

      const holder = track(manager.addHighPriorityTask(requestFor(0), { onEvent: consumer(true).sink }));
      const waiting = track(
        manager.addHighPriorityTask(requestFor(1), { signal: controller.signal, onEvent: consumer(true).sink })
      );
      await vi.advanceTimersByTimeAsync(100);
      controller.abort();
      await settleAll([holder, waiting], 60_000, 10);

      expect(errorName(waiting.error)).toBe('AbortError');
      expect(provider.attempts(1)).toBe(0);
      // A cancelled call keeps its tokens and its request
      expect(recording.log.filter((entry) => entry.kind === 'acquire')).toHaveLength(2);
      expect(recording.log.filter((entry) => entry.kind === 'used').map((entry) => entry.tokens)).toEqual([0]);
    });

    // The rate limiter wait watches the caller's signal, so an aborted call frees its slot at once
    it('a call aborted while it waits for tokens ends at once', async () => {
      const limiter = realLimiter({ newTokensPerSecond: 10 });
      const provider = fakeProvider();
      provider.scripts.set(0, [[{ event: DELTA }, { wait: 20_000 }, { event: DELTA }]]);
      const manager = new GenerateCallManager<Body, Reply>(
        'scenario',
        { ...BASE_CONFIG, concurrency: 2, streamIdleTimeoutMs: 0 },
        fixedApi(provider, limiter)
      );
      const controller = new AbortController();

      void manager.addHighPriorityTask(requestFor(0), { onEvent: consumer(true).sink });
      const waiting = track(
        manager.addHighPriorityTask(requestFor(1), { signal: controller.signal, onEvent: consumer(true).sink })
      );
      await vi.advanceTimersByTimeAsync(100);
      controller.abort();
      await vi.advanceTimersByTimeAsync(10);

      // The budget refills in ten seconds; the abort should not have to wait for it
      expect(waiting.done).toBe(true);
      expect(errorName(waiting.error)).toBe('AbortError');
    });
  });

  describe('configuration', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    });

    const queueConfig: GenerateWithQueueConfig = {
      ...BASE_CONFIG,
      minPollerInterval: 10,
      maxPollerInterval: 100,
      pollerTimeCoefficient: 2
    };
    const emptyQueue = () =>
      ({
        publish: vi.fn(),
        consume: vi.fn(async () => undefined),
        subscribe: vi.fn()
      }) as unknown as Strategy.LoftQueue;

    it.each([
      { concurrency: 0 },
      { concurrency: -1 },
      { concurrency: 2.5 },
      { concurrency: Number.NaN },
      { concurrency: Number.POSITIVE_INFINITY },
      { streamIdleTimeoutMs: -1 },
      { streamIdleTimeoutMs: 0.5 },
      { streamIdleTimeoutMs: Number.NaN },
      { streamIdleTimeoutMs: 2_147_483_648 },
      { streamFirstEventTimeoutMs: -1 },
      { streamFirstEventTimeoutMs: 1.5 },
      { streamFirstEventTimeoutMs: Number.POSITIVE_INFINITY },
      { streamFirstEventTimeoutMs: '1000' as unknown as number }
    ])('the queued manager rejects %o in its constructor and starts nothing', (config) => {
      const provider = fakeProvider();
      expect(
        () =>
          new GenerateWithQueueManager<Body, Reply>(
            'scenario',
            { ...queueConfig, ...config },
            llmApi(provider, recordingLimiter().limiter),
            emptyQueue(),
            emptyQueue()
          )
      ).toThrow(RangeError);
      // No poller was started by a manager that failed to construct
      expect(vi.getTimerCount()).toBe(0);
    });

    it('the queued manager applies the stream timeouts and the concurrency to a streamed call', async () => {
      const provider = fakeProvider();
      provider.scripts.set(0, [[{ event: DELTA }, { hang: true }]]);
      provider.scripts.set(1, [[{ hang: true }]]);
      provider.scripts.set(2, [[{ event: DELTA }, { wait: 100 }, { event: DELTA }]]);
      const manager = new GenerateWithQueueManager<Body, Reply>(
        'scenario',
        {
          ...queueConfig,
          concurrency: 3,
          retryAttemptsLimit: 1,
          streamIdleTimeoutMs: 700,
          streamFirstEventTimeoutMs: 400
        },
        llmApi(provider, recordingLimiter().limiter),
        emptyQueue(),
        emptyQueue()
      );
      try {
        const runs = [0, 1, 2].map((id) =>
          track(manager.addHighPriorityTask(requestFor(id), { onEvent: consumer(true).sink }))
        );
        await settleAll(runs, 10_000, 10);

        expect(runs[0].error).toMatchObject({ name: 'StreamIdleTimeoutError', timeoutMs: 700 });
        expect(runs[1].error).toMatchObject({ name: 'StreamIdleTimeoutError', timeoutMs: 400 });
        expect(runs[2].value).toEqual({ id: 2, actual: actualOf(2) });
        expect(provider.maxInFlight()).toBe(3);
      } finally {
        manager.stop();
      }
    });

    it('accepts the bounds of every timeout and a large concurrency', () => {
      const provider = fakeProvider();
      for (const value of [0, 1, 2_147_483_647]) {
        expect(
          () =>
            new GenerateCallManager<Body, Reply>(
              'scenario',
              { ...BASE_CONFIG, concurrency: 1000, streamIdleTimeoutMs: value, streamFirstEventTimeoutMs: value },
              llmApi(provider, recordingLimiter().limiter)
            )
        ).not.toThrow();
      }
    });
  });
});
