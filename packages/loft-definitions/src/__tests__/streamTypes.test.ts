import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Chat, Interface, Strategy } from '..';
import { StreamIdleTimeoutError } from '..';

const base = { seq: 0, runId: 'run-1' };

describe('stream types', () => {
  it('ChatStreamEvent narrows on type', () => {
    const describeEvent = (event: Chat.ChatStreamEvent): string => {
      switch (event.type) {
        case 'text-delta':
          expectTypeOf(event.delta).toBeString();
          expectTypeOf(event.step).toBeNumber();
          return event.delta;
        case 'finish':
          expectTypeOf(event.usage).toEqualTypeOf<Strategy.LLM.StreamUsage>();
          expectTypeOf(event.reason).toEqualTypeOf<Chat.ChatFinishReason>();
          expectTypeOf(event.finishReason).toBeString();
          return event.text;
        case 'step-finish':
          expectTypeOf(event.reason).toEqualTypeOf<Chat.ChatFinishReason>();
          return event.finishReason;
        case 'error':
          expectTypeOf(event.code).toEqualTypeOf<Chat.ChatStreamErrorCode>();
          expectTypeOf(event.retryAfterMs).toEqualTypeOf<number | undefined>();
          return event.message;
        case 'abort':
          expectTypeOf(event.reason).toEqualTypeOf<'timeout' | 'cancelled'>();
          return event.reason;
        case 'tool-call':
          expectTypeOf(event.args).toEqualTypeOf<Record<string, unknown> | undefined>();
          return event.name;
        default:
          return event.type;
      }
    };

    expect(describeEvent({ ...base, type: 'text-delta', step: 0, delta: 'Hi' })).toBe('Hi');
    expect(describeEvent({ ...base, type: 'abort', reason: 'cancelled' })).toBe('cancelled');
    // @ts-expect-error an abort says why
    void describeEvent({ ...base, type: 'abort' });
    // @ts-expect-error a text-delta needs its delta
    void describeEvent({ ...base, type: 'text-delta', step: 0 });
    // @ts-expect-error an unknown event type is not part of the union
    void describeEvent({ ...base, type: 'unknown-event' });
  });

  it('GenerateOptions accepts onEvent', () => {
    const seen: string[] = [];
    const options: Chat.GenerateOptions = {
      sessionId: 'session-1',
      onEvent: (event) => {
        seen.push(event.type);
      },
      streamOptions: { enabled: false, include: { reasoning: true, toolCalls: 'args' }, textPolicy: 'after-middleware' }
    };

    expectTypeOf(options.onEvent).toEqualTypeOf<((event: Chat.ChatStreamEvent) => void) | undefined>();
    expectTypeOf(options.streamOptions).toEqualTypeOf<Chat.StreamOptions | undefined>();
    // @ts-expect-error toolCalls only takes none, names or args
    const wrong: Chat.StreamOptions = { include: { toolCalls: 'all' } };
    void wrong;
    expect(seen).toEqual([]);
  });

  it('CallOptions without onEvent valid', () => {
    const options: Strategy.LLM.CallOptions = {};
    const withSignal: Strategy.LLM.CallOptions = { signal: new AbortController().signal };

    expectTypeOf(options.onEvent).toEqualTypeOf<Strategy.LLM.LlmStreamSink | undefined>();
    expect(withSignal.onEvent).toBeUndefined();
  });

  it('LlmStreamSink may return void', () => {
    const returnsVoid: Strategy.LLM.LlmStreamSink = () => undefined;
    const returnsBoolean: Strategy.LLM.LlmStreamSink = (event) => event.type === 'text-delta';

    expect(returnsVoid({ type: 'activity' })).toBeUndefined();
    expect(returnsBoolean({ type: 'text-delta', delta: 'a' })).toBe(true);
    // @ts-expect-error a sink cannot return a string
    const wrong: Strategy.LLM.LlmStreamSink = () => 'delivered';
    void wrong;
  });

  it('StreamUsage has no Date fields', () => {
    const usage: Strategy.LLM.StreamUsage = { inputTokens: 1, outputTokens: 2, totalTokens: 3 };

    expectTypeOf<Strategy.LLM.StreamUsage>().not.toHaveProperty('generateStartTime');
    expect(JSON.parse(JSON.stringify(usage))).toEqual(usage);
  });

  it('LlmManager.generate takes LlmGenerateOptions last', () => {
    type CallOptionsParam = Parameters<Interface.LlmManager['generate']>[6];

    expectTypeOf<CallOptionsParam>().toEqualTypeOf<Interface.LlmGenerateOptions | undefined>();
    expectTypeOf<Interface.LlmGenerateOptions['events']>().toEqualTypeOf<Chat.GenerationEventSink | undefined>();
    expectTypeOf<Interface.LlmGenerateOptions>().toMatchTypeOf<Strategy.LLM.CallOptions>();
  });
});

describe('StreamIdleTimeoutError', () => {
  it('has a literal name, a fixed message and an optional timeout', () => {
    const error = new StreamIdleTimeoutError(30000);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('StreamIdleTimeoutError');
    expect(error.message).toBe('The model stream was idle for too long.');
    expect(error.timeoutMs).toBe(30000);
    expect(new StreamIdleTimeoutError().timeoutMs).toBeUndefined();
  });
});
