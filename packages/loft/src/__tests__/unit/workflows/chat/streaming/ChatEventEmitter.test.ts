import { Chat, Logger, Strategy } from '@moc-global/loft-definitions';
import { configureSpyLoggerStrategy } from '@moc-global/loft-test-suite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatEventEmitter } from '../../../../../workflows/chat/streaming/ChatEventEmitter';
import {
  ResolvedStreamOptions,
  resolveStreamOptions
} from '../../../../../workflows/chat/streaming/resolveStreamOptions';

const spyLogger = configureSpyLoggerStrategy();
const log = new Logger('ChatEventEmitter');

beforeEach(() => vi.clearAllMocks());

function setup(options: Partial<ResolvedStreamOptions> = {}, onEvent?: (event: Chat.ChatStreamEvent) => void) {
  const events: Chat.ChatStreamEvent[] = [];
  const emitter = new ChatEventEmitter((event) => {
    events.push(event);
    onEvent?.(event);
  }, log);
  emitter.configure({ ...resolveStreamOptions(), ...options }, []);
  emitter.start('session-1');
  return { emitter, events };
}

function sinkOf(emitter: ChatEventEmitter, step: number): Strategy.LLM.LlmStreamSink {
  const sink = emitter.provider(step);
  if (!sink) throw new Error('expected a provider sink');
  return sink;
}

// The event types in order, with the status phase spelled out
function shape(events: Chat.ChatStreamEvent[]): string[] {
  return events.map((event) => (event.type === 'status' ? `status:${event.phase}` : event.type));
}

function usage(inputTokens: number, outputTokens: number, extra: Partial<Strategy.LLM.StreamUsage> = {}) {
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, ...extra };
}

function ofType<T extends Chat.ChatStreamEvent['type']>(events: Chat.ChatStreamEvent[], type: T) {
  return events.filter((event): event is Extract<Chat.ChatStreamEvent, { type: T }> => event.type === type);
}

const call = { toolCallId: 'call-1', name: 'lookup', args: { city: 'Kyiv' } };
const result = { toolCallId: 'call-1', name: 'lookup', status: 'succeeded' as const, durationMs: 12 };

// One tool round, then a streamed answer
function runToolRound(emitter: ChatEventEmitter) {
  const first = emitter.stepStart();
  sinkOf(emitter, first)({ type: 'request-start' });
  emitter.stepText(first, '');
  emitter.toolCall(first, call);
  emitter.data(first, { toolCallId: 'call-1', toolName: 'lookup' }, 'progress', { done: 1 });
  emitter.toolResult(first, result);
  emitter.stepFinish(first, { finishReason: 'tool_calls', hadToolCalls: true, usage: usage(10, 2) });

  const second = emitter.stepStart();
  const sink = sinkOf(emitter, second);
  sink({ type: 'request-start' });
  sink({ type: 'text-delta', delta: 'Sunny' });
  emitter.stepText(second, 'Sunny');
  emitter.stepFinish(second, { finishReason: 'stop', hadToolCalls: false, usage: usage(20, 3) });
  emitter.finish({ finishReason: 'stop', text: 'Sunny' });
}

describe('ChatEventEmitter', () => {
  describe('order', () => {
    it('seq from 0 without gaps', () => {
      const { emitter, events } = setup();
      runToolRound(emitter);

      expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
      expect(shape(events)).toEqual([
        'start',
        'step-start',
        'status:queued',
        'status:generating',
        'tool-call',
        'data',
        'tool-result',
        'step-finish',
        'step-start',
        'status:queued',
        'status:generating',
        'text-delta',
        'step-finish',
        'finish'
      ]);
    });

    it('status queued then generating per step', () => {
      const { emitter, events } = setup();
      for (const step of [0, 1]) {
        expect(emitter.stepStart()).toBe(step);
        sinkOf(emitter, step)({ type: 'request-start' });
        emitter.stepText(step, '');
        emitter.stepFinish(step, { finishReason: 'stop', hadToolCalls: false, usage: usage(1, 1) });
      }

      const statuses = ofType(events, 'status').map((event) => `${event.step}:${event.phase}`);
      expect(statuses).toEqual(['0:queued', '0:generating', '1:queued', '1:generating']);
    });

    it('generating synthesized when request-start never arrives', () => {
      // A custom call manager that passes the sink on but never reports an attempt
      const streamed = setup();
      const step = streamed.emitter.stepStart();
      sinkOf(streamed.emitter, step)({ type: 'text-delta', delta: 'Hi' });
      expect(shape(streamed.events).slice(1)).toEqual([
        'step-start',
        'status:queued',
        'status:generating',
        'text-delta'
      ]);

      // No sink at all: the status comes right before the fallback text
      const observed = setup({ enabled: false });
      const observedStep = observed.emitter.stepStart();
      observed.emitter.stepText(observedStep, 'Hi');
      expect(shape(observed.events).slice(1)).toEqual([
        'step-start',
        'status:queued',
        'status:generating',
        'text-delta'
      ]);
    });

    it('status generating repeats after a retry', () => {
      const { emitter, events } = setup();
      const step = emitter.stepStart();
      const sink = sinkOf(emitter, step);
      sink({ type: 'request-start' });
      sink({ type: 'activity' });
      sink({ type: 'request-start' });
      sink({ type: 'text-delta', delta: 'ok' });

      expect(shape(events).slice(1)).toEqual([
        'step-start',
        'status:queued',
        'status:generating',
        'status:generating',
        'text-delta'
      ]);
    });
  });

  describe('terminal events', () => {
    it('one terminal event, nothing after it', () => {
      const { emitter, events } = setup();
      const step = emitter.stepStart();
      const sink = sinkOf(emitter, step);
      emitter.finish({ finishReason: 'stop', text: '' });
      const count = events.length;

      expect(sink({ type: 'text-delta', delta: 'late' })).toBe(false);
      expect(sink({ type: 'request-start' })).toBe(false);
      emitter.stepText(step, 'late');
      emitter.toolCall(step, call);
      emitter.data(step, { toolCallId: 'call-1', toolName: 'lookup' }, 'late', {});
      emitter.toolResult(step, result);
      emitter.stepFinish(step, { finishReason: 'stop', hadToolCalls: false, usage: usage(1, 1) });
      emitter.stepStart();
      emitter.fail(new Error('late'));
      emitter.finish({ finishReason: 'stop', text: 'again' });

      expect(events).toHaveLength(count);
      expect(ofType(events, 'finish')).toHaveLength(1);
      expect(emitter.finished).toBe(true);
    });

    it('nothing is sent before start', () => {
      const events: Chat.ChatStreamEvent[] = [];
      const emitter = new ChatEventEmitter((event) => events.push(event), log);
      const step = emitter.stepStart();
      emitter.stepText(step, 'text');
      emitter.fail(new Error('boom'));
      emitter.finish({ finishReason: 'stop', text: 'text' });

      expect(events).toEqual([]);
      expect(emitter.started).toBe(false);
      expect(emitter.finished).toBe(false);
    });

    it('fail with an aborted signal emits abort', () => {
      const aborted = setup();
      const controller = new AbortController();
      controller.abort();
      aborted.emitter.fail(new Error('aborted'), controller.signal);
      aborted.emitter.fail(new Error('again'), controller.signal);
      expect(shape(aborted.events)).toEqual(['start', 'abort']);

      const failed = setup();
      failed.emitter.fail(new Error('boom'), new AbortController().signal);
      expect(failed.events.at(-1)).toMatchObject({
        type: 'error',
        code: 'internal',
        message: 'Failed to generate a response.',
        retryable: false
      });
    });

    it('abort says whether a timeout or the caller aborted', async () => {
      const reasonOf = (signal: AbortSignal) => {
        const { emitter, events } = setup();
        emitter.fail(signal.reason, signal);
        return ofType(events, 'abort')[0]?.reason;
      };
      const abortedWith = (reason?: unknown) => {
        const controller = new AbortController();
        controller.abort(reason);
        return controller.signal;
      };

      const timedOut = AbortSignal.timeout(1);
      await new Promise((resolve) => timedOut.addEventListener('abort', resolve, { once: true }));
      expect(reasonOf(timedOut)).toBe('timeout');
      // A timeout combined with the caller's signal keeps its reason
      expect(reasonOf(AbortSignal.any([new AbortController().signal, timedOut]))).toBe('timeout');
      expect(reasonOf(abortedWith(new DOMException('took too long', 'TimeoutError')))).toBe('timeout');
      expect(reasonOf(abortedWith(Object.assign(new Error('took too long'), { name: 'TimeoutError' })))).toBe(
        'timeout'
      );

      expect(reasonOf(abortedWith())).toBe('cancelled');
      expect(reasonOf(abortedWith(new Error('client went away')))).toBe('cancelled');
      expect(reasonOf(abortedWith('TimeoutError'))).toBe('cancelled');
      expect(reasonOf(abortedWith({ name: 'TimeoutError' }))).toBe('cancelled');
    });

    it('a step cut short by an error or an abort gets no step-finish; the final event ends it', () => {
      const cutShort = (signal?: AbortSignal) => {
        const { emitter, events } = setup();
        const step = emitter.stepStart();
        const sink = sinkOf(emitter, step);
        sink({ type: 'request-start' });
        sink({ type: 'text-delta', delta: 'Hal' });
        emitter.fail(Object.assign(new Error('stream reset'), { status: 503 }), signal);
        return shape(events);
      };
      const controller = new AbortController();
      controller.abort();

      const before = ['start', 'step-start', 'status:queued', 'status:generating', 'text-delta'];
      expect(cutShort()).toEqual([...before, 'error']);
      expect(cutShort(controller.signal)).toEqual([...before, 'abort']);
    });

    it('messages never include the cause text', () => {
      const { emitter, events } = setup();
      const cause = Object.assign(new Error('secret provider detail'), { status: 500 });
      emitter.fail(new Error('wrapper detail', { cause }));

      const error = ofType(events, 'error')[0];
      expect(error).toMatchObject({ code: 'provider_error', message: 'The model provider returned an error.' });
      expect(JSON.stringify(events)).not.toContain('detail');
    });
  });

  describe('text', () => {
    it('fallback text-delta only when the step streamed nothing and the text is non-empty', () => {
      const { emitter, events } = setup();

      const streamed = emitter.stepStart();
      sinkOf(emitter, streamed)({ type: 'text-delta', delta: 'Hello' });
      emitter.stepText(streamed, 'Hello');
      emitter.stepFinish(streamed, { finishReason: 'stop', hadToolCalls: false, usage: usage(1, 1) });

      const empty = emitter.stepStart();
      emitter.stepText(empty, '');
      emitter.stepFinish(empty, { finishReason: 'tool_calls', hadToolCalls: true, usage: usage(1, 1) });

      const fallback = emitter.stepStart();
      emitter.stepText(fallback, 'Block');
      emitter.stepFinish(fallback, { finishReason: 'stop', hadToolCalls: false, usage: usage(1, 1) });

      expect(ofType(events, 'text-delta').map((event) => [event.step, event.delta])).toEqual([
        [streamed, 'Hello'],
        [fallback, 'Block']
      ]);
      expect(ofType(events, 'step-finish').map((event) => event.streamed)).toEqual([true, false, false]);
    });

    it('after-middleware emits final text once before finish', () => {
      const { emitter, events } = setup({ textPolicy: 'after-middleware', reasoning: true });
      const step = emitter.stepStart();
      const sink = sinkOf(emitter, step);
      sink({ type: 'request-start' });
      expect(sink({ type: 'text-delta', delta: 'raw' })).toBe(false);
      emitter.stepText(step, 'raw');
      emitter.stepFinish(step, { finishReason: 'stop', hadToolCalls: false, usage: usage(5, 5) });
      emitter.finish({ finishReason: 'stop', text: 'Polished' });

      expect(ofType(events, 'text-delta')).toEqual([expect.objectContaining({ step: 1, delta: 'Polished' })]);
      expect(shape(events).slice(-6)).toEqual([
        'step-start',
        'status:queued',
        'status:generating',
        'text-delta',
        'step-finish',
        'finish'
      ]);
      const textStep = ofType(events, 'step-finish')[1];
      expect(textStep).toEqual(
        expect.objectContaining({ step: 1, finishReason: 'stop', hadToolCalls: false, streamed: false })
      );
      expect(textStep.usage).toBeUndefined();
      expect(ofType(events, 'finish')[0]).toMatchObject({ text: 'Polished', textReplaced: false });
    });

    it('after-middleware with empty final text adds no text step', () => {
      const { emitter, events } = setup({ textPolicy: 'after-middleware' });
      const step = emitter.stepStart();
      emitter.stepText(step, '');
      emitter.stepFinish(step, { finishReason: 'stop', hadToolCalls: false, usage: usage(1, 1) });
      emitter.finish({ finishReason: 'stop', text: '' });

      expect(ofType(events, 'step-start')).toHaveLength(1);
      expect(ofType(events, 'finish')[0]).toMatchObject({ text: '', textReplaced: false });
    });

    it('synthetic response text is emitted only by finish', () => {
      // A prevented generation: no model step ran
      const prevented = setup();
      prevented.emitter.markSynthetic();
      prevented.emitter.finish({ finishReason: 'stop', text: 'Canned' });
      expect(shape(prevented.events)).toEqual([
        'start',
        'step-start',
        'status:queued',
        'status:generating',
        'text-delta',
        'step-finish',
        'finish'
      ]);
      expect(ofType(prevented.events, 'text-delta')[0]).toMatchObject({ step: 0, delta: 'Canned' });

      // An interceptor override after a streamed tool round
      const overridden = setup();
      const step = overridden.emitter.stepStart();
      sinkOf(overridden.emitter, step)({ type: 'text-delta', delta: 'Checking' });
      overridden.emitter.stepText(step, 'Checking');
      overridden.emitter.toolCall(step, call);
      overridden.emitter.toolResult(step, result);
      overridden.emitter.markSynthetic();
      overridden.emitter.stepText(step, 'not sent');
      overridden.emitter.stepFinish(step, { finishReason: 'tool_calls', hadToolCalls: true, usage: usage(3, 3) });
      overridden.emitter.finish({ finishReason: 'stop', text: 'Overridden' });

      expect(ofType(overridden.events, 'text-delta').map((event) => [event.step, event.delta])).toEqual([
        [0, 'Checking'],
        [1, 'Overridden']
      ]);
      expect(ofType(overridden.events, 'finish')[0]).toMatchObject({ text: 'Overridden', textReplaced: false });
    });

    it('stepText sends no fallback text once the response is synthetic', () => {
      const { emitter, events } = setup();
      emitter.markSynthetic();
      const step = emitter.stepStart();
      emitter.stepText(step, 'model text');
      emitter.stepFinish(step, { finishReason: 'stop', hadToolCalls: false, usage: usage(1, 1) });
      emitter.finish({ finishReason: 'stop', text: 'final' });

      expect(ofType(events, 'text-delta').map((event) => event.delta)).toEqual(['final']);
    });

    it('loop limit finishes with empty text and max_loops_exceeded', () => {
      const { emitter, events } = setup();
      const step = emitter.stepStart();
      emitter.stepText(step, '');
      emitter.loopLimitReached();
      emitter.stepFinish(step, { finishReason: 'tool_calls', hadToolCalls: true, usage: usage(1, 1) });
      emitter.finish({ finishReason: 'tool_calls', text: 'Internal loop limit message' });

      expect(ofType(events, 'finish')[0]).toMatchObject({
        finishReason: 'max_loops_exceeded',
        text: '',
        textReplaced: false
      });
      expect(JSON.stringify(events)).not.toContain('loop limit message');
    });

    it('loop limit under after-middleware adds no text step', () => {
      const { emitter, events } = setup({ textPolicy: 'after-middleware' });
      emitter.loopLimitReached();
      emitter.finish({ finishReason: 'tool_calls', text: 'Internal loop limit message' });

      expect(shape(events)).toEqual(['start', 'finish']);
      expect(ofType(events, 'finish')[0]).toMatchObject({ finishReason: 'max_loops_exceeded', text: '' });
    });

    it('textReplaced', () => {
      const run = (finalText: string) => {
        const { emitter, events } = setup();
        const step = emitter.stepStart();
        const sink = sinkOf(emitter, step);
        sink({ type: 'text-delta', delta: 'Hel' });
        sink({ type: 'text-delta', delta: 'lo' });
        emitter.stepText(step, 'Hello');
        emitter.stepFinish(step, { finishReason: 'stop', hadToolCalls: false, usage: usage(1, 1) });
        emitter.finish({ finishReason: 'stop', text: finalText });
        return ofType(events, 'finish')[0].textReplaced;
      };

      expect(run('Hello')).toBe(false);
      expect(run('Hello, edited')).toBe(true);
    });

    it('finish sends the text in its own step when no step ran', () => {
      const { emitter, events } = setup({ textPolicy: 'all' });
      emitter.finish({ finishReason: 'stop', text: 'Hi' });

      expect(shape(events)).toEqual([
        'start',
        'step-start',
        'status:queued',
        'status:generating',
        'text-delta',
        'step-finish',
        'finish'
      ]);
      expect(ofType(events, 'text-delta')[0]).toMatchObject({ step: 0, delta: 'Hi' });
      expect(ofType(events, 'finish')[0]).toMatchObject({ text: 'Hi', textReplaced: false });
    });

    it('finish closes an open step before the text step', () => {
      const closing = ['step-start', 'status:queued', 'status:generating', 'text-delta', 'step-finish', 'finish'];

      // Text held until the end: the open step had a tool call
      const held = setup({ textPolicy: 'after-middleware', toolCalls: 'none' });
      const heldStep = held.emitter.stepStart();
      held.emitter.stepText(heldStep, 'raw');
      held.emitter.toolCall(heldStep, call);
      held.emitter.finish({ finishReason: 'stop', text: 'Polished' });

      expect(shape(held.events)).toEqual([
        'start',
        'step-start',
        'status:queued',
        'status:generating',
        'step-finish',
        ...closing
      ]);
      expect(ofType(held.events, 'step-finish')[0]).toEqual(
        expect.objectContaining({ step: 0, finishReason: 'stop', hadToolCalls: true, streamed: false })
      );
      expect(ofType(held.events, 'step-finish')[0]).not.toHaveProperty('usage');
      expect(ofType(held.events, 'text-delta')[0]).toMatchObject({ step: 1, delta: 'Polished' });
      expect(ofType(held.events, 'finish')[0].usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

      // A synthetic response: the open step streamed text before the override
      const synthetic = setup();
      const syntheticStep = synthetic.emitter.stepStart();
      sinkOf(synthetic.emitter, syntheticStep)({ type: 'text-delta', delta: 'Checking' });
      synthetic.emitter.markSynthetic();
      synthetic.emitter.finish({ finishReason: 'stop', text: 'Overridden' });

      expect(shape(synthetic.events)).toEqual([
        'start',
        'step-start',
        'status:queued',
        'status:generating',
        'text-delta',
        'step-finish',
        ...closing
      ]);
      expect(ofType(synthetic.events, 'step-finish')[0]).toMatchObject({
        step: 0,
        hadToolCalls: false,
        streamed: true
      });
      expect(ofType(synthetic.events, 'finish')[0]).toMatchObject({ text: 'Overridden', textReplaced: false });
    });

    it('finish closes an open step that streamed the final text', () => {
      const run = (finalText: string) => {
        const { emitter, events } = setup({ textPolicy: 'all' });
        const step = emitter.stepStart();
        const sink = sinkOf(emitter, step);
        sink({ type: 'request-start' });
        sink({ type: 'text-delta', delta: 'ab' });
        sink({ type: 'text-delta', delta: 'c' });
        emitter.finish({ finishReason: 'stop', text: finalText });
        return events;
      };

      const same = run('abc');
      expect(shape(same).slice(-2)).toEqual(['step-finish', 'finish']);
      expect(ofType(same, 'step-start')).toHaveLength(1);
      expect(ofType(same, 'step-finish')[0]).toMatchObject({ step: 0, finishReason: 'stop', streamed: true });
      expect(ofType(same, 'finish')[0].textReplaced).toBe(false);

      expect(ofType(run('abd'), 'finish')[0].textReplaced).toBe(true);
    });

    it('textReplaced compares with the final step only', () => {
      const { emitter, events } = setup();
      const first = emitter.stepStart();
      sinkOf(emitter, first)({ type: 'text-delta', delta: 'Let me check. ' });
      emitter.stepFinish(first, { finishReason: 'tool_calls', hadToolCalls: true, usage: usage(1, 1) });
      const second = emitter.stepStart();
      sinkOf(emitter, second)({ type: 'text-delta', delta: 'Sunny' });
      emitter.stepFinish(second, { finishReason: 'stop', hadToolCalls: false, usage: usage(1, 1) });
      emitter.finish({ finishReason: 'stop', text: 'Sunny' });

      expect(ofType(events, 'finish')[0].textReplaced).toBe(false);
    });
  });

  describe('provider sink', () => {
    it('observe-only returns no provider sink', () => {
      expect(setup({ enabled: false }).emitter.provider(0)).toBeUndefined();
      expect(setup({ textPolicy: 'after-middleware', reasoning: false }).emitter.provider(0)).toBeUndefined();
      expect(setup({ textPolicy: 'after-middleware', reasoning: true }).emitter.provider(0)).toBeDefined();
      expect(setup({ textPolicy: 'all' }).emitter.provider(0)).toBeDefined();
    });

    it('returns no provider sink before start, so a call made without events is not streamed', () => {
      const emitter = new ChatEventEmitter(() => undefined, log);
      emitter.configure({ ...resolveStreamOptions(), textPolicy: 'all' }, []);

      expect(emitter.provider(0)).toBeUndefined();
      emitter.start('session-1');
      expect(emitter.provider(0)).toBeDefined();
    });

    it('start.streaming false in observe-only', () => {
      const start = (options: Partial<ResolvedStreamOptions>) => ofType(setup(options).events, 'start')[0];

      expect(start({ enabled: false })).toMatchObject({ streaming: false, sessionId: 'session-1' });
      expect(start({ textPolicy: 'after-middleware' })).toMatchObject({
        streaming: false,
        textPolicy: 'after-middleware'
      });
      expect(start({ textPolicy: 'after-middleware', reasoning: true })).toMatchObject({ streaming: true });
      expect(start({})).toMatchObject({ streaming: true, textPolicy: 'all' });
    });

    it('sink returns true only when it forwarded', () => {
      const all = setup({ reasoning: true });
      const step = all.emitter.stepStart();
      const sink = sinkOf(all.emitter, step);
      expect(sink({ type: 'request-start' })).toBe(false);
      expect(sink({ type: 'activity' })).toBe(false);
      expect(sink({ type: 'usage', usage: { inputTokens: 3 } })).toBe(false);
      expect(sink({ type: 'text-delta', delta: '' })).toBe(false);
      expect(sink({ type: 'text-delta', delta: 'a' })).toBe(true);
      expect(sink({ type: 'reasoning-delta', delta: 'b' })).toBe(true);

      const held = setup({ textPolicy: 'after-middleware', reasoning: true });
      const heldStep = held.emitter.stepStart();
      const heldSink = sinkOf(held.emitter, heldStep);
      expect(heldSink({ type: 'text-delta', delta: 'a' })).toBe(false);
      expect(heldSink({ type: 'reasoning-delta', delta: 'b' })).toBe(true);

      expect(shape(all.events)).not.toContain('usage');
      expect(shape(all.events)).not.toContain('activity');
    });

    it('sink of a finished step returns false', () => {
      const { emitter, events } = setup();
      const step = emitter.stepStart();
      const sink = sinkOf(emitter, step);
      emitter.stepFinish(step, { finishReason: 'stop', hadToolCalls: false, usage: usage(1, 1) });
      const count = events.length;

      expect(sink({ type: 'text-delta', delta: 'late' })).toBe(false);
      expect(events).toHaveLength(count);
    });

    it('reasoning off by default', () => {
      expect(resolveStreamOptions().reasoning).toBe(false);

      const { emitter, events } = setup();
      const step = emitter.stepStart();
      expect(sinkOf(emitter, step)({ type: 'reasoning-delta', delta: 'thinking' })).toBe(false);
      expect(ofType(events, 'reasoning-delta')).toEqual([]);
    });

    it('first-output time resets at request-start and counts activity', () => {
      vi.useFakeTimers();
      try {
        const { emitter } = setup();
        const step = emitter.stepStart();
        const sink = sinkOf(emitter, step);

        vi.setSystemTime(new Date('2026-10-22T10:00:00Z'));
        sink({ type: 'request-start' });
        expect(emitter.firstOutputAt(step)).toBeUndefined();
        sink({ type: 'usage', usage: { inputTokens: 1 } });
        expect(emitter.firstOutputAt(step)).toBeUndefined();

        vi.setSystemTime(new Date('2026-10-22T10:00:01Z'));
        sink({ type: 'text-delta', delta: 'lost attempt' });
        expect(emitter.firstOutputAt(step)).toEqual(new Date('2026-10-22T10:00:01Z'));

        // A retry starts over; its first output is a chunk the provider keeps back
        vi.setSystemTime(new Date('2026-10-22T10:00:05Z'));
        sink({ type: 'request-start' });
        expect(emitter.firstOutputAt(step)).toBeUndefined();
        vi.setSystemTime(new Date('2026-10-22T10:00:06Z'));
        sink({ type: 'activity' });
        vi.setSystemTime(new Date('2026-10-22T10:00:07Z'));
        sink({ type: 'text-delta', delta: 'later' });
        expect(emitter.firstOutputAt(step)).toEqual(new Date('2026-10-22T10:00:06Z'));
        expect(emitter.firstOutputAt(step + 1)).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('first-output time counts text held back by the policy', () => {
      const { emitter } = setup({ textPolicy: 'after-middleware', reasoning: true });
      const step = emitter.stepStart();
      sinkOf(emitter, step)({ type: 'text-delta', delta: 'held' });
      expect(emitter.firstOutputAt(step)).toBeInstanceOf(Date);
    });
  });

  describe('tools', () => {
    it('toolCalls none/names/args', () => {
      const run = (toolCalls: ResolvedStreamOptions['toolCalls']) => {
        const { emitter, events } = setup({ toolCalls });
        const step = emitter.stepStart();
        emitter.toolCall(step, call);
        emitter.toolResult(step, result);
        return events;
      };

      const none = run('none');
      expect(ofType(none, 'tool-call')).toEqual([]);
      expect(ofType(none, 'tool-result')).toEqual([]);

      const names = run('names');
      expect(ofType(names, 'tool-call')[0]).toEqual(
        expect.objectContaining({ step: 0, toolCallId: 'call-1', name: 'lookup' })
      );
      expect(ofType(names, 'tool-call')[0]).not.toHaveProperty('args');
      expect(ofType(names, 'tool-result')).toHaveLength(1);

      const withArgs = run('args');
      expect(ofType(withArgs, 'tool-call')[0].args).toEqual({ city: 'Kyiv' });
    });

    it('tool-call args are a copy', () => {
      const args = { city: 'Kyiv', nested: { days: 3 } };
      const { emitter, events } = setup({ toolCalls: 'args' });
      const step = emitter.stepStart();
      emitter.toolCall(step, { ...call, args });

      const sent = ofType(events, 'tool-call')[0].args;
      expect(sent).toEqual(args);
      if (sent) (sent.nested as { days: number }).days = 99;
      expect(args.nested.days).toBe(3);

      // Arguments that cannot be copied are left out, and the event is still sent
      emitter.toolCall(step, { ...call, toolCallId: 'call-2', args: { fn: () => 1 } });
      const second = ofType(events, 'tool-call')[1];
      expect(second).toMatchObject({ toolCallId: 'call-2', name: 'lookup' });
      expect(second).not.toHaveProperty('args');
    });

    it('tool outputs never emitted', () => {
      const { emitter, events } = setup({ toolCalls: 'args' });
      const step = emitter.stepStart();
      emitter.toolCall(step, call);
      emitter.toolResult(step, { ...result, status: 'failed' });

      const toolResult = ofType(events, 'tool-result')[0];
      expect(Object.keys(toolResult).sort()).toEqual(
        ['durationMs', 'name', 'runId', 'seq', 'status', 'step', 'toolCallId', 'type'].sort()
      );
      expect(toolResult.status).toBe('failed');
    });

    it('emit after tool-result is dropped', () => {
      const { emitter, events } = setup({ toolCalls: 'none' });
      const step = emitter.stepStart();
      const tool = { toolCallId: 'call-1', toolName: 'lookup' };
      emitter.data(step, tool, 'progress', { value: 1 });
      emitter.toolResult(step, result);
      emitter.data(step, tool, 'progress', { value: 2 });
      emitter.data(step, { toolCallId: 'call-2', toolName: 'other' }, 'progress', { value: 3 });

      expect(ofType(events, 'data').map((event) => [event.toolCallId, event.data])).toEqual([
        ['call-1', { value: 1 }],
        ['call-2', { value: 3 }]
      ]);
      expect(ofType(events, 'data')[0]).toMatchObject({ step, toolName: 'lookup', name: 'progress' });
      // status generating comes first, also when tool calls are not sent
      expect(shape(events)).toEqual(['start', 'step-start', 'status:queued', 'status:generating', 'data', 'data']);
    });

    it('a call id reused in a later step is a new tool call', () => {
      const { emitter, events } = setup({ toolCalls: 'none' });
      const tool = { toolCallId: 'call-1', toolName: 'lookup' };
      const first = emitter.stepStart();
      emitter.data(first, tool, 'progress', { value: 1 });
      emitter.toolResult(first, result);
      emitter.stepFinish(first, { finishReason: 'tool_calls', hadToolCalls: true, usage: usage(1, 1) });

      // Some providers number the calls of each response from the start, so the id comes back in the next step
      const second = emitter.stepStart();
      emitter.data(second, tool, 'progress', { value: 2 });
      emitter.toolResult(second, result);
      emitter.data(second, tool, 'progress', { value: 3 });

      expect(ofType(events, 'data').map((event) => [event.step, event.data])).toEqual([
        [first, { value: 1 }],
        [second, { value: 2 }]
      ]);
    });
  });

  describe('callback and logs', () => {
    it('contains a throwing onEvent', () => {
      const { emitter, events } = setup({}, () => {
        throw new Error('consumer bug');
      });
      runToolRound(emitter);

      expect(ofType(events, 'finish')).toHaveLength(1);
      expect(emitter.finished).toBe(true);
      expect(spyLogger.warn).toHaveBeenCalledTimes(events.length);
      expect(spyLogger.warn).toHaveBeenCalledWith(expect.any(String), 'ChatEventEmitter', { type: 'start' });
      expect(spyLogger.warn).toHaveBeenLastCalledWith(expect.any(String), 'ChatEventEmitter', { type: 'finish' });
    });

    it('contains an async onEvent that rejects', async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        const events: Chat.ChatStreamEvent[] = [];
        const emitter = new ChatEventEmitter(async (event) => {
          events.push(event);
          throw new Error('consumer bug SENTINEL-async');
        }, log);
        emitter.configure(resolveStreamOptions(), []);
        emitter.start('session-1');
        runToolRound(emitter);
        // Rejections are reported after the microtasks and one more turn of the event loop
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));

        expect(unhandled).toEqual([]);
        expect(ofType(events, 'finish')).toHaveLength(1);
        expect(emitter.finished).toBe(true);
        expect(spyLogger.warn).toHaveBeenCalledTimes(events.length);
        expect(spyLogger.warn).toHaveBeenCalledWith(expect.any(String), 'ChatEventEmitter', { type: 'start' });
        expect(spyLogger.warn).toHaveBeenLastCalledWith(expect.any(String), 'ChatEventEmitter', { type: 'finish' });
        expect(JSON.stringify(vi.mocked(spyLogger.warn).mock.calls)).not.toContain('SENTINEL-async');
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });

    it('an async onEvent that resolves logs nothing', async () => {
      const emitter = new ChatEventEmitter(async () => undefined, log);
      emitter.configure(resolveStreamOptions(), []);
      emitter.start('session-1');
      runToolRound(emitter);
      await new Promise((resolve) => setImmediate(resolve));

      expect(emitter.finished).toBe(true);
      expect(spyLogger.warn).not.toHaveBeenCalled();
    });

    it('logs never contain payloads', () => {
      const sentinel = 'SENTINEL-7f3a';
      const events: Chat.ChatStreamEvent[] = [];
      const emitter = new ChatEventEmitter((event) => {
        events.push(event);
        throw new Error(`consumer ${sentinel}`);
      }, log);
      emitter.configure(
        resolveStreamOptions(undefined, { include: { reasoning: true, toolCalls: 'args' } }, ['payloadCheckMw']),
        ['payloadCheckMw']
      );
      emitter.start('session-1');

      const step = emitter.stepStart();
      const sink = sinkOf(emitter, step);
      sink({ type: 'request-start' });
      sink({ type: 'text-delta', delta: sentinel });
      sink({ type: 'reasoning-delta', delta: sentinel });
      emitter.stepText(step, sentinel);
      emitter.toolCall(step, { toolCallId: 'call-1', name: 'lookup', args: { secret: sentinel } });
      emitter.data(step, { toolCallId: 'call-1', toolName: 'lookup' }, 'progress', { secret: sentinel });
      emitter.toolResult(step, result);
      emitter.stepFinish(step, { finishReason: 'stop', hadToolCalls: true, usage: usage(1, 1) });
      emitter.fail(new Error(sentinel, { cause: Object.assign(new Error(sentinel), { status: 500 }) }));

      expect(JSON.stringify(events)).toContain(sentinel);
      const logged = Object.values(spyLogger).flatMap((spy) => vi.mocked(spy).mock.calls.flat());
      expect(logged.length).toBeGreaterThan(0);
      for (const argument of logged) {
        expect(JSON.stringify(argument) ?? '').not.toContain(sentinel);
      }
    });

    it('warns once naming the middleware', () => {
      const names = ['redactPii', 'translateReply'];
      const configure = (middleware: string[]) => {
        const emitter = new ChatEventEmitter(() => undefined, log);
        emitter.configure(resolveStreamOptions(undefined, undefined, middleware), middleware);
      };

      configure(names);
      configure(names);
      // The same middleware in another order is the same set
      configure([...names].reverse());
      expect(spyLogger.warn).toHaveBeenCalledTimes(1);
      const [message] = vi.mocked(spyLogger.warn).mock.calls[0];
      expect(message).toContain('redactPii');
      expect(message).toContain('translateReply');

      // No warning when the policy was chosen, or when it defaulted to streaming
      const chosen = new ChatEventEmitter(() => undefined, log);
      chosen.configure(resolveStreamOptions({ textPolicy: 'after-middleware' }, undefined, ['other']), ['other']);
      const defaultedToAll = new ChatEventEmitter(() => undefined, log);
      defaultedToAll.configure(resolveStreamOptions(), []);
      expect(spyLogger.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('finish reason', () => {
    it('step-finish and finish carry the normalized reason beside the raw one', () => {
      const { emitter, events } = setup();
      runToolRound(emitter);

      expect(ofType(events, 'step-finish').map(({ reason, finishReason }) => [reason, finishReason])).toEqual([
        ['tool-calls', 'tool_calls'],
        ['stop', 'stop']
      ]);
      expect(ofType(events, 'finish')[0]).toMatchObject({ reason: 'stop', finishReason: 'stop' });
    });

    it('a step that called tools and stopped counts as tool-calls', () => {
      const { emitter, events } = setup();
      const step = emitter.stepStart();
      emitter.toolCall(step, call);
      emitter.stepFinish(step, { finishReason: 'STOP', hadToolCalls: true, usage: usage(1, 1) });
      emitter.finish({ finishReason: 'STOP', text: '' });

      expect(ofType(events, 'step-finish')[0]).toMatchObject({ reason: 'tool-calls', finishReason: 'STOP' });
      expect(ofType(events, 'finish')[0]).toMatchObject({ reason: 'tool-calls', finishReason: 'STOP' });
    });

    it('the loop limit, steps closed by finish and the text step', () => {
      const limited = setup();
      const step = limited.emitter.stepStart();
      limited.emitter.toolCall(step, call);
      limited.emitter.loopLimitReached();
      limited.emitter.finish({ finishReason: 'tool_calls', text: 'Internal loop limit message' });
      expect(ofType(limited.events, 'step-finish')[0]).toMatchObject({
        reason: 'other',
        finishReason: 'max_loops_exceeded'
      });
      expect(ofType(limited.events, 'finish')[0]).toMatchObject({
        reason: 'other',
        finishReason: 'max_loops_exceeded'
      });

      const held = setup({ textPolicy: 'after-middleware' });
      held.emitter.stepStart();
      held.emitter.finish({ finishReason: 'max_tokens', text: 'Polished' });
      expect(ofType(held.events, 'step-finish').map((event) => event.reason)).toEqual(['length', 'length']);
      expect(ofType(held.events, 'finish')[0]).toMatchObject({ reason: 'length', finishReason: 'max_tokens' });

      const unknown = setup();
      unknown.emitter.finish({ finishReason: 'unknown', text: 'Canned' });
      expect(ofType(unknown.events, 'step-finish')[0]).toMatchObject({ reason: 'other' });
      expect(ofType(unknown.events, 'finish')[0]).toMatchObject({ reason: 'other', finishReason: 'unknown' });
    });
  });

  describe('usage and identity', () => {
    afterEach(() => vi.useRealTimers());

    it('finish.usage sums steps', () => {
      const { emitter, events } = setup();
      const first = emitter.stepStart();
      emitter.stepFinish(first, {
        finishReason: 'tool_calls',
        hadToolCalls: true,
        usage: usage(100, 10, { cacheTokens: 50, totalCost: 0.25, model: 'model-a', finishReason: 'tool_calls' })
      });
      const second = emitter.stepStart();
      const withDate = { ...usage(200, 20, { reasoningTokens: 7, totalCost: 0.5 }), generateStartTime: new Date() };
      emitter.stepFinish(second, { finishReason: 'stop', hadToolCalls: false, usage: withDate });
      emitter.finish({ finishReason: 'stop', text: '' });

      expect(ofType(events, 'finish')[0].usage).toEqual({
        inputTokens: 300,
        outputTokens: 30,
        totalTokens: 330,
        cacheTokens: 50,
        reasoningTokens: 7,
        totalCost: 0.75
      });
      expect(ofType(events, 'step-finish')[1].usage).toEqual(usage(200, 20, { reasoningTokens: 7, totalCost: 0.5 }));
      expect(ofType(events, 'step-finish')[1].usage).not.toHaveProperty('generateStartTime');
    });

    it('finish.usage takes model and finish reason from the last step, and is zero without steps', () => {
      const { emitter, events } = setup();
      const first = emitter.stepStart();
      emitter.stepFinish(first, {
        finishReason: 'tool_calls',
        hadToolCalls: true,
        usage: usage(1, 1, { model: 'model-a', finishReason: 'tool_calls' })
      });
      const second = emitter.stepStart();
      emitter.stepFinish(second, {
        finishReason: 'stop',
        hadToolCalls: false,
        usage: usage(1, 1, { model: 'model-b', finishReason: 'stop' })
      });
      emitter.finish({ finishReason: 'stop', text: '' });
      expect(ofType(events, 'finish')[0].usage).toMatchObject({ model: 'model-b', finishReason: 'stop' });

      const empty = setup();
      empty.emitter.markSynthetic();
      empty.emitter.finish({ finishReason: 'stop', text: 'Canned' });
      expect(ofType(empty.events, 'finish')[0].usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    });

    it('runId is set and stable for one call', () => {
      const { emitter, events } = setup();
      runToolRound(emitter);
      const runIds = new Set(events.map((event) => event.runId));
      expect(runIds.size).toBe(1);
      expect([...runIds][0]).toMatch(/^[0-9a-f-]{36}$/);

      const other = setup();
      expect(other.events[0].runId).not.toBe(events[0].runId);

      const given: Chat.ChatStreamEvent[] = [];
      const named = new ChatEventEmitter((event) => given.push(event), log, { runId: 'run-42' });
      named.start('session-1');
      named.finish({ finishReason: 'stop', text: '' });
      expect(given.map((event) => event.runId)).toEqual(['run-42', 'run-42']);
    });

    it('keeps the call options it was created with', () => {
      const streamOptions: Chat.StreamOptions = { textPolicy: 'all' };

      expect(new ChatEventEmitter(() => undefined, log, { streamOptions }).streamOptions).toBe(streamOptions);
      expect(new ChatEventEmitter(() => undefined, log).streamOptions).toBeUndefined();
    });
  });
});
