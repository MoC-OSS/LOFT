import 'reflect-metadata';

import { NativeCallManagerStrategy, Strategy, Type } from '@moc-global/loft-definitions';
import { GenerateCallManager } from '@moc-global/loft-llm-call-manager';
import {
  ScriptedLLMApi,
  ScriptedLLMCall,
  ScriptedLLMStrategy,
  ScriptedReply,
  ScriptedResponse
} from '@moc-global/loft-test-suite';
import { describe, expect, it } from 'vitest';

const call: ScriptedLLMCall = {
  systemMessage: 'system',
  messages: [],
  toolNames: [],
  modelPreset: { model: 'scripted' }
};

const request = (): Strategy.LLM.LLMRequest<ScriptedLLMCall> => ({
  sessionId: 'session',
  requestType: Strategy.LLM.LLMRequestType.GENERATE,
  llmName: 'scripted',
  llmBody: call
});

function collect() {
  const events: Strategy.LLM.LlmStreamEvent[] = [];
  const onEvent: Strategy.LLM.LlmStreamSink = (event) => {
    events.push(event);
  };
  return { events, onEvent };
}

describe('scripted streaming', () => {
  it('chunks emit in order', async () => {
    const llm = new ScriptedLLMStrategy('scripted', [
      { text: 'Hello world', chunks: ['Hel', 'lo ', 'world'], activityChunks: 2, chunkDelayMs: 1 }
    ]);
    const { events, onEvent } = collect();

    const response = await llm.generate(request(), { onEvent });

    expect(events).toEqual([
      { type: 'activity' },
      { type: 'activity' },
      { type: 'text-delta', delta: 'Hel' },
      { type: 'text-delta', delta: 'lo ' },
      { type: 'text-delta', delta: 'world' }
    ]);
    expect(response.llmBody).toEqual({ text: 'Hello world', toolCalls: [] });
  });

  it('ignores chunks without an onEvent sink', async () => {
    const llm = new ScriptedLLMStrategy('scripted', [
      { text: 'ab', chunks: ['a', 'b'], failAfterChunks: new Error('stream broke') },
      { text: 'ab', chunks: ['a', 'b'], waitForAbortAfterChunks: true }
    ]);

    await expect(llm.generate(request())).resolves.toMatchObject({ llmBody: { text: 'ab' } });
    await expect(llm.generate(request())).resolves.toMatchObject({ llmBody: { text: 'ab' } });
  });

  it('streams the text that sits beside tool calls', async () => {
    const llm = new ScriptedLLMStrategy('scripted', [
      { text: 'Let me check', chunks: ['Let me ', 'check'], toolCalls: [{ name: 'lookup', callId: 'c1' }] }
    ]);
    const { events, onEvent } = collect();

    const response = await llm.generate(request(), { onEvent });

    expect(events.map((event) => event.type)).toEqual(['text-delta', 'text-delta']);
    expect(response.llmBody.toolCalls).toEqual([{ name: 'lookup', callId: 'c1', arguments: undefined }]);
  });

  it('mismatched chunks throw', async () => {
    const mismatched: ScriptedReply = { text: 'Hello', chunks: ['Hel', 'LO'] };

    expect(() => new ScriptedLLMStrategy('scripted', [mismatched])).toThrow(/chunks/);
    expect(() => new ScriptedLLMStrategy('scripted').script(mismatched)).toThrow(/chunks/);
    expect(() => new ScriptedLLMApi([mismatched])).toThrow(/chunks/);

    // A reply function is checked when it produces its turn
    const llm = new ScriptedLLMStrategy('scripted', [() => mismatched]);
    await expect(llm.generate(request(), { onEvent: () => undefined })).rejects.toThrow(/chunks/);
  });

  it('abort between chunks', async () => {
    const llm = new ScriptedLLMStrategy('scripted', [{ text: 'abc', chunks: ['a', 'b', 'c'] }]);
    const controller = new AbortController();
    const reason = new Error('cancelled');
    const events: Strategy.LLM.LlmStreamEvent[] = [];

    const result = llm.generate(request(), {
      signal: controller.signal,
      onEvent: (event) => {
        events.push(event);
        controller.abort(reason);
      }
    });

    await expect(result).rejects.toBe(reason);
    expect(events).toEqual([{ type: 'text-delta', delta: 'a' }]);
  });

  it('abort ends the wait between chunks', async () => {
    const llm = new ScriptedLLMStrategy('scripted', [{ text: 'ab', chunks: ['a', 'b'], chunkDelayMs: 60_000 }]);
    const controller = new AbortController();
    const reason = new Error('cancelled');

    const result = llm.generate(request(), { signal: controller.signal, onEvent: () => controller.abort(reason) });

    await expect(result).rejects.toBe(reason);
  });

  it('fails after the chunks when failAfterChunks is set', async () => {
    const failure = new Error('stream broke');
    const llm = new ScriptedLLMStrategy('scripted', [{ text: 'ab', chunks: ['a', 'b'], failAfterChunks: failure }]);
    const { events, onEvent } = collect();

    await expect(llm.generate(request(), { onEvent })).rejects.toBe(failure);
    expect(events).toEqual([
      { type: 'text-delta', delta: 'a' },
      { type: 'text-delta', delta: 'b' }
    ]);
  });

  it('hangs after the chunks until aborted when waitForAbortAfterChunks is set', async () => {
    const llm = new ScriptedLLMStrategy('scripted', [
      { text: 'ab', chunks: ['a', 'b'], waitForAbortAfterChunks: true }
    ]);
    const controller = new AbortController();
    const reason = new Error('cancelled');
    const { events, onEvent } = collect();

    const result = llm.generate(request(), { signal: controller.signal, onEvent });
    await expect.poll(() => events.length).toBe(2);
    controller.abort(reason);

    await expect(result).rejects.toBe(reason);
  });

  it('waits chunkDelayMs before every event after the first, activity included', async () => {
    const llm = new ScriptedLLMStrategy('scripted', [
      { text: 'a', chunks: ['a'], activityChunks: 2, chunkDelayMs: 30 }
    ]);
    const times: number[] = [];

    await llm.generate(request(), { onEvent: () => void times.push(Date.now()) });

    expect(times).toHaveLength(3);
    // Timers may fire a millisecond early, so allow some slack
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(25);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(25);
  });

  it('activity then silence with empty chunks and waitForAbortAfterChunks', async () => {
    const llm = new ScriptedLLMStrategy('scripted', [
      { text: '', chunks: [], activityChunks: 1, waitForAbortAfterChunks: true }
    ]);
    const controller = new AbortController();
    const { events, onEvent } = collect();

    const result = llm.generate(request(), { signal: controller.signal, onEvent });
    await expect.poll(() => events.length).toBe(1);
    controller.abort(new Error('cancelled'));

    await expect(result).rejects.toThrow('cancelled');
    expect(events).toEqual([{ type: 'activity' }]);
  });

  it('abort during the last chunk wins over failAfterChunks', async () => {
    const reason = new Error('cancelled');
    const llm = new ScriptedLLMStrategy('scripted', [
      { text: 'a', chunks: ['a'], failAfterChunks: new Error('stream broke') }
    ]);
    const controller = new AbortController();

    const result = llm.generate(request(), { signal: controller.signal, onEvent: () => controller.abort(reason) });

    await expect(result).rejects.toBe(reason);
  });

  describe('with a call manager', () => {
    const setup = (replies: ScriptedReply[]) => {
      const api = new ScriptedLLMApi(replies);
      const callManager = new GenerateCallManager<ScriptedLLMCall, ScriptedResponse>(
        'scripted',
        { highPriorityTasksLimit: 10, retryDelay: 1, retryAttemptsLimit: 2 },
        api
      );
      const llm = new ScriptedLLMStrategy('scripted', [], new NativeCallManagerStrategy(callManager));
      return { api, llm };
    };

    it('ScriptedLLMApi behind a real GenerateCallManager delivers the deltas', async () => {
      const { api, llm } = setup([{ text: 'Hi there', chunks: ['Hi ', 'there'], activityChunks: 1 }]);
      const { events, onEvent } = collect();

      const response = await llm.generate(request(), { onEvent });

      // The call manager sends request-start before the provider call; the API never does
      expect(events).toEqual([
        { type: 'request-start' },
        { type: 'activity' },
        { type: 'text-delta', delta: 'Hi ' },
        { type: 'text-delta', delta: 'there' }
      ]);
      expect(response.llmBody).toEqual({ text: 'Hi there', toolCalls: [] });
      expect(api.calls).toEqual([call]);
      expect(llm.calls).toEqual([call]);
      llm.stop();
    });

    it('retries a call that failed before any event, then streams', async () => {
      const overloaded = Object.assign(new Error('overloaded'), { status: 503 });
      const { api, llm } = setup([{ error: overloaded }, { text: 'ok', chunks: ['o', 'k'] }]);
      const { events, onEvent } = collect();

      const response = await llm.generate(request(), { onEvent });

      // A retryable error before any event is retried, and each attempt starts with its own request-start
      expect(api.calls).toHaveLength(2);
      expect(events).toEqual([
        { type: 'request-start' },
        { type: 'request-start' },
        { type: 'text-delta', delta: 'o' },
        { type: 'text-delta', delta: 'k' }
      ]);
      expect(response.llmBody.text).toBe('ok');
      llm.stop();
    });

    it('refuses replies on the strategy, which belong to the ScriptedLLMApi', () => {
      const callManagerStrategy = new NativeCallManagerStrategy(
        new GenerateCallManager<ScriptedLLMCall, ScriptedResponse>(
          'scripted',
          { highPriorityTasksLimit: 1, retryDelay: 1, retryAttemptsLimit: 1 },
          new ScriptedLLMApi()
        )
      );
      expect(() => new ScriptedLLMStrategy('scripted', [{ text: 'x' }], callManagerStrategy)).toThrow(/ScriptedLLMApi/);
      const llm = new ScriptedLLMStrategy('scripted', [], callManagerStrategy);
      expect(() => llm.script({ text: 'x' })).toThrow(/ScriptedLLMApi/);
      expect(() => llm.remainingReplies).toThrow(/ScriptedLLMApi/);
    });
  });
});

describe('ScriptedLLMApi', () => {
  it('emits only activity and text-delta events, never request-start', async () => {
    const api = new ScriptedLLMApi([{ text: 'Hi there', chunks: ['Hi ', 'there'], activityChunks: 2 }]);
    const { events, onEvent } = collect();

    const response = await api.generate<ScriptedLLMCall, ScriptedResponse>(call, { onEvent });

    expect(events).toEqual([
      { type: 'activity' },
      { type: 'activity' },
      { type: 'text-delta', delta: 'Hi ' },
      { type: 'text-delta', delta: 'there' }
    ]);
    expect(response).toEqual({ text: 'Hi there', toolCalls: [] });
  });

  it('tracks scripted replies and rejects the legacy stream methods', async () => {
    const api = new ScriptedLLMApi([{ text: 'one' }]);
    api.script({ text: 'two' });
    expect(api.remainingReplies).toBe(2);

    await api.generate(call);
    expect(api.remainingReplies).toBe(1);

    await expect(api.generateStream(call)).rejects.toThrow(/not support/);
    expect(() => api.extractContentFromChunk({})).toThrow(/not support/);
  });

  it('reports fixed token numbers and reduces a request to its text', async () => {
    const api = new ScriptedLLMApi();
    const withMessages: ScriptedLLMCall = {
      ...call,
      messages: [{ role: Type.LLM.UnifiedMessageRole.user, text: 'hello', toolCalls: [], toolResults: [] }]
    };

    expect(api.reduceMessages(withMessages)).toBe('system\nhello');
    expect(api.llmTokenizer.calculateTokensFromString('anything')).toBe(api.llmTokenizer.calculateTokensFromString(''));
    expect(api.extractUsedTokens({})).toBe(15);
    await expect(api.tokenRateLimiter.acquire?.(1_000_000)).resolves.toBeUndefined();
  });

  it('fails a call after the last reply', async () => {
    await expect(new ScriptedLLMApi().generate(call)).rejects.toThrow(/no reply/);
  });
});
