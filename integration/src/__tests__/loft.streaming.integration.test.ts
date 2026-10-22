import 'reflect-metadata';

import {
  Chat,
  ContextInterface,
  Interface,
  Logger,
  NativeCallManagerStrategy,
  StandardMiddleware,
  StreamIdleTimeoutError
} from '@moc-global/loft-definitions';
import { GenerateCallManager, GenerateConfig } from '@moc-global/loft-llm-call-manager';
import {
  configureSpyLoggerStrategy,
  ScriptedLLMApi,
  ScriptedLLMCall,
  ScriptedReply,
  ScriptedResponse
} from '@moc-global/loft-test-suite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initDB, type TestDatabaseInstance } from './initDB';
import { SCRIPTED_LLM, ScriptedChatOptions, startScriptedChat, summarize, userMessage } from './scriptedChat';

type StreamEvent = Chat.ChatStreamEvent;

const TERMINAL = new Set(['finish', 'error', 'abort']);

function ofType<T extends StreamEvent['type']>(events: StreamEvent[], type: T) {
  return events.filter((event): event is Extract<StreamEvent, { type: T }> => event.type === type);
}

// The event types in order, with the status phase, so the order of a whole call reads in one list
const sequence = (events: StreamEvent[]) =>
  events.map((event) => (event.type === 'status' ? `status:${event.phase}` : event.type));

// Every call numbers its events 0, 1, 2… under one run id and ends with exactly one terminal event, sent last
function expectWellFormed(events: StreamEvent[]) {
  expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
  expect(new Set(events.map((event) => event.runId)).size).toBe(1);
  expect(events.filter((event) => TERMINAL.has(event.type))).toHaveLength(1);
  expect(TERMINAL.has(events.at(-1)?.type ?? '')).toBe(true);
}

function collect() {
  const events: StreamEvent[] = [];
  return { events, onEvent: (event: StreamEvent) => void events.push(event) };
}

// A retryable provider error, as an SDK reports a 503
const providerError = (message: string) => Object.assign(new Error(message), { status: 503 });

// The error and its causes, as generate() wraps the provider's error
function causesOf(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = error;
  while (current instanceof Error && chain.length < 5) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

// An AfterGenerate middleware that changes the reply text
const shout: StandardMiddleware<ContextInterface, Chat.GenerateResultMessages> = async (_ctx, payload, chain) => {
  payload.llmResponse.topChoice.content = payload.llmResponse.topChoice.content.map((part) =>
    part.type === 'text' ? { ...part, text: part.text.toUpperCase() } : part
  );
  chain.next();
  return payload;
};

// An additional tool that reports progress through context.emit and answers with `output`
function lookupOrderTool(output: string, data: unknown): Chat.AdditionalTool {
  return {
    definition: {
      name: 'lookup_order',
      description: 'Looks up an order',
      inputSchema: {
        type: Chat.AdditionalToolSchemaType.OBJECT,
        properties: { orderId: { type: 'string' } },
        required: ['orderId']
      }
    },
    async handler(_args, context) {
      context?.emit('progress', data);
      return { content: [{ type: Chat.AdditionalToolContentType.TEXT, text: output }] };
    }
  };
}

describe('Loft streaming through the real packages', () => {
  let testDb: TestDatabaseInstance;

  beforeAll(async () => {
    testDb = await initDB();
  });

  afterAll(async () => {
    await testDb?.close();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
  });

  // The scripted provider API behind a real GenerateCallManager, so the call manager's request-start, retries and
  // timeouts run as they do with a real provider
  async function start(
    replies: ScriptedReply[],
    config: Partial<GenerateConfig> = {},
    options: Omit<ScriptedChatOptions, 'callManagerStrategy'> = {}
  ) {
    const api = new ScriptedLLMApi(replies);
    const callManager = new GenerateCallManager<ScriptedLLMCall, ScriptedResponse>(
      SCRIPTED_LLM,
      { highPriorityTasksLimit: 10, retryDelay: 1, retryAttemptsLimit: 2, ...config },
      api
    );
    const chat = await startScriptedChat(testDb, [], {
      ...options,
      callManagerStrategy: new NativeCallManagerStrategy(callManager)
    });
    const history = async (sessionId = chat.session.id) => [...(await chat.loft.chat.getChatHistory(sessionId))];
    return { ...chat, api, history };
  }

  it('tool round and answer stream; save() stores what generate() stores', async () => {
    const toolRound: ScriptedReply = {
      text: 'Let me check',
      chunks: ['Let me ', 'check'],
      activityChunks: 1,
      toolCalls: [{ name: 'lookup_order', arguments: { orderId: '42' }, callId: 'call-1' }]
    };
    const answer: ScriptedReply = { text: 'Order 42 shipped', chunks: ['Order 42', ' shipped'] };
    // The same two replies, once streamed and once without onEvent
    const { loft, session, api, history } = await start([toolRound, answer, toolRound, answer]);
    const plainSession = await loft.chat.createSession({
      currentLlmName: SCRIPTED_LLM,
      currentManifestName: 'test-bot',
      ctx: {}
    });
    const tool = lookupOrderTool('Order 42: shipped yesterday', { percent: 50 });
    const { events, onEvent } = collect();

    const streamed = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [userMessage('Where is order 42?', session.id)],
      additionalTools: [tool],
      onEvent
    });
    await streamed.messages.save();
    const plain = await loft.chat.generate({
      sessionId: plainSession.id,
      directMessages: [userMessage('Where is order 42?', plainSession.id)],
      additionalTools: [tool]
    });
    await plain.messages.save();

    expectWellFormed(events);
    expect(sequence(events)).toEqual([
      'start',
      'step-start',
      'status:queued',
      'status:generating',
      'text-delta',
      'text-delta',
      'tool-call',
      'data',
      'tool-result',
      'step-finish',
      'step-start',
      'status:queued',
      'status:generating',
      'text-delta',
      'text-delta',
      'step-finish',
      'finish'
    ]);
    expect(events[0]).toMatchObject({ type: 'start', sessionId: session.id, textPolicy: 'all', streaming: true });
    expect(ofType(events, 'text-delta').map(({ step, delta }) => [step, delta])).toEqual([
      [0, 'Let me '],
      [0, 'check'],
      [1, 'Order 42'],
      [1, ' shipped']
    ]);
    // Tool calls default to names only: no arguments, and never the output
    expect(ofType(events, 'tool-call')).toEqual([
      expect.objectContaining({ step: 0, toolCallId: 'call-1', name: 'lookup_order' })
    ]);
    expect(ofType(events, 'tool-call')[0]).not.toHaveProperty('args');
    expect(ofType(events, 'data')).toEqual([
      expect.objectContaining({
        step: 0,
        toolCallId: 'call-1',
        toolName: 'lookup_order',
        name: 'progress',
        data: { percent: 50 }
      })
    ]);
    expect(ofType(events, 'tool-result')).toEqual([
      expect.objectContaining({ step: 0, toolCallId: 'call-1', name: 'lookup_order', status: 'succeeded' })
    ]);
    expect(
      ofType(events, 'step-finish').map(({ step, hadToolCalls, streamed: wasStreamed }) => [
        step,
        hadToolCalls,
        wasStreamed
      ])
    ).toEqual([
      [0, true, true],
      [1, false, true]
    ]);
    const [finish] = ofType(events, 'finish');
    expect(finish).toMatchObject({ finishReason: 'stop', text: 'Order 42 shipped', textReplaced: false });
    // Two scripted calls of 10 input and 5 output tokens each
    expect(finish.usage).toMatchObject({ inputTokens: 20, outputTokens: 10, totalTokens: 30 });

    // The streamed call returns and saves exactly what the plain call does
    expect(summarize(streamed.messages.llmResponse.topChoice)).toEqual(summarize(plain.messages.llmResponse.topChoice));
    const streamedHistory = (await history()).map(summarize);
    expect(streamedHistory).toEqual((await history(plainSession.id)).map(summarize));
    expect(streamedHistory.at(-1)?.text).toBe(finish.text);
    // The data event is never saved
    expect(JSON.stringify(await history())).not.toContain('percent');
    expect(api.calls).toHaveLength(4);
  });

  it('mid-stream failure: deltas, error, nothing saved', async () => {
    const failure = providerError('upstream reset the stream');
    const { loft, session, api, history } = await start([
      { text: 'Your order', chunks: ['Your ', 'order'], failAfterChunks: failure },
      // Never used: a call whose text reached the caller is not retried
      { text: 'Your order shipped' }
    ]);
    const { events, onEvent } = collect();

    const generation = loft.chat.generate({
      sessionId: session.id,
      directMessages: [userMessage('Where is my order?', session.id)],
      onEvent
    });

    const error = await generation.then(
      () => undefined,
      (reason: unknown) => reason
    );
    expect(causesOf(error)).toContain(failure);
    expectWellFormed(events);
    expect(sequence(events)).toEqual([
      'start',
      'step-start',
      'status:queued',
      'status:generating',
      'text-delta',
      'text-delta',
      'error'
    ]);
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: 'error',
        code: 'provider_error',
        message: 'The model provider returned an error.',
        retryable: true
      })
    );
    expect(JSON.stringify(events)).not.toContain('upstream reset');
    expect(api.calls).toHaveLength(1);
    expect(api.remainingReplies).toBe(1);
    expect(await history()).toHaveLength(0);
  });

  it('abort: abort event, nothing saved', async () => {
    const { loft, session, history } = await start([
      { text: 'A long story', chunks: ['A ', 'long ', 'story'], waitForAbortAfterChunks: true }
    ]);
    const controller = new AbortController();
    const { events, onEvent } = collect();

    const generation = loft.chat.generate({
      sessionId: session.id,
      directMessages: [userMessage('Tell me a story', session.id)],
      signal: controller.signal,
      onEvent: (event) => {
        onEvent(event);
        if (event.type === 'text-delta') controller.abort(new Error('the user left'));
      }
    });

    await expect(generation).rejects.toBeDefined();
    expectWellFormed(events);
    expect(sequence(events)).toEqual([
      'start',
      'step-start',
      'status:queued',
      'status:generating',
      'text-delta',
      'abort'
    ]);
    expect(ofType(events, 'text-delta').map((event) => event.delta)).toEqual(['A ']);
    expect(await history()).toHaveLength(0);
  });

  it('after-middleware: retry after undelivered deltas succeeds through the real call manager', async () => {
    const reply = { text: 'your order shipped', chunks: ['your order', ' shipped'] };
    const { loft, session, api, history } = await start(
      [{ ...reply, failAfterChunks: providerError('overloaded') }, reply],
      {},
      {
        configure: ({ chatConstructor }) => chatConstructor.registerAfterGenerateMiddleware('shout', shout)
      }
    );
    const { events, onEvent } = collect();

    const result = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [userMessage('Where is my order?', session.id)],
      onEvent,
      // Reasoning keeps the provider streaming; the text it streams is held until the middleware ran. The sink does
      // not deliver held text, so the call manager may retry the attempt that failed after it.
      streamOptions: { textPolicy: 'after-middleware', include: { reasoning: true } }
    });
    await result.messages.save();

    expectWellFormed(events);
    // The first attempt streamed text that was held back, so nothing reached the caller and it could be retried
    expect(api.calls).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'start', textPolicy: 'after-middleware', streaming: true });
    expect(sequence(events)).toEqual([
      'start',
      'step-start',
      'status:queued',
      // One per attempt
      'status:generating',
      'status:generating',
      'step-finish',
      // The final text in a step of its own, after the middleware changed it
      'step-start',
      'status:queued',
      'status:generating',
      'text-delta',
      'step-finish',
      'finish'
    ]);
    expect(ofType(events, 'text-delta')).toEqual([expect.objectContaining({ step: 1, delta: 'YOUR ORDER SHIPPED' })]);
    expect(ofType(events, 'step-finish').map((event) => event.streamed)).toEqual([false, false]);
    expect(events.at(-1)).toMatchObject({ type: 'finish', text: 'YOUR ORDER SHIPPED', textReplaced: false });
    expect((await history()).map(summarize).at(-1)?.text).toBe('YOUR ORDER SHIPPED');
  });

  it('idle timeout through the real call manager', async () => {
    const { loft, session, api, history } = await start(
      [
        // Silent after an activity event, which does not reach the caller: timed out and retried
        { text: '', chunks: [], activityChunks: 1, waitForAbortAfterChunks: true },
        // Silent after text that reached the caller: timed out, and not retried
        { text: 'Hel', chunks: ['Hel'], waitForAbortAfterChunks: true },
        { text: 'never sent' }
      ],
      { streamIdleTimeoutMs: 50, retryAttemptsLimit: 3 }
    );
    const { events, onEvent } = collect();

    const error = await loft.chat
      .generate({ sessionId: session.id, directMessages: [userMessage('Hello', session.id)], onEvent })
      .then(
        () => undefined,
        (reason: unknown) => reason
      );

    expect(causesOf(error).some((cause) => cause instanceof StreamIdleTimeoutError)).toBe(true);
    expect(api.calls).toHaveLength(2);
    expectWellFormed(events);
    expect(sequence(events)).toEqual([
      'start',
      'step-start',
      'status:queued',
      'status:generating',
      'status:generating',
      'text-delta',
      'error'
    ]);
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: 'error',
        code: 'timeout',
        message: 'The response took too long.',
        retryable: true
      })
    );
    expect(await history()).toHaveLength(0);
  });

  describe('logs', () => {
    // The Logger as it was before the test, restored afterwards so later tests do not log to the spy
    let previous: { logLevel: Interface.LogLevel; loggerStrategy: Interface.LoggerStrategy };

    beforeEach(() => {
      previous = { logLevel: Logger.logLevel, loggerStrategy: Logger.loggerStrategy };
    });

    afterEach(() => {
      Logger.configure(previous);
    });

    it('no payload sentinel in any log', async () => {
      // One sentinel in every payload, tagged with where it was put
      const SENTINEL = 'SENTINEL-c0ffee';
      const failure = providerError(`provider said ${SENTINEL}:error`);
      const spy = configureSpyLoggerStrategy(Interface.LogLevel.TRACE);
      const { loft, session } = await start(
        [
          {
            text: `Checking ${SENTINEL}:delta`,
            chunks: ['Checking ', `${SENTINEL}:delta`],
            toolCalls: [{ name: 'lookup_order', arguments: { orderId: `${SENTINEL}:args` }, callId: 'call-1' }]
          },
          { text: `Shipped ${SENTINEL}:delta`, chunks: ['Shipped ', `${SENTINEL}:delta`] },
          { text: `Partial ${SENTINEL}:delta`, chunks: ['Partial ', `${SENTINEL}:delta`], failAfterChunks: failure },
          // Aborted by the caller after the first delta
          { text: `${SENTINEL}:delta more`, chunks: [`${SENTINEL}:delta`, ' more'], waitForAbortAfterChunks: true },
          // Silent after an activity event (timed out and retried), then silent after a delta (timed out)
          { text: '', chunks: [], activityChunks: 1, waitForAbortAfterChunks: true },
          { text: `${SENTINEL}:delta`, chunks: [`${SENTINEL}:delta`], waitForAbortAfterChunks: true }
        ],
        { streamIdleTimeoutMs: 50 },
        {
          // Every package logs through the spy at the most verbose level. The LOFT constructor has just configured
          // the Logger, and the test suite package may load a copy of loft-definitions of its own (in the CommonJS
          // run), so the packages' Logger is pointed at the spy here as well.
          configure: () => Logger.configure({ logLevel: Interface.LogLevel.TRACE, loggerStrategy: spy })
        }
      );
      const { events, onEvent } = collect();

      const result = await loft.chat.generate({
        sessionId: session.id,
        directMessages: [userMessage('Where is order 42?', session.id)],
        additionalTools: [lookupOrderTool(`Order found ${SENTINEL}:output`, { note: `${SENTINEL}:data` })],
        onEvent,
        streamOptions: { include: { toolCalls: 'args' } }
      });
      await result.messages.save();
      await expect(
        loft.chat.generate({
          sessionId: session.id,
          directMessages: [userMessage('And order 43?', session.id)],
          onEvent
        })
      ).rejects.toBeDefined();

      const controller = new AbortController();
      const aborted = collect();
      await expect(
        loft.chat.generate({
          sessionId: session.id,
          directMessages: [userMessage('Tell me more', session.id)],
          signal: controller.signal,
          onEvent: (event) => {
            aborted.onEvent(event);
            if (event.type === 'text-delta') controller.abort(new Error('the user left'));
          }
        })
      ).rejects.toBeDefined();

      const timedOut = collect();
      await expect(
        loft.chat.generate({
          sessionId: session.id,
          directMessages: [userMessage('Still there?', session.id)],
          onEvent: timedOut.onEvent
        })
      ).rejects.toBeDefined();

      // The payloads reached the caller and the tool, so the checks below are not vacuous
      const sent = JSON.stringify(events);
      for (const kind of ['delta', 'args', 'data']) expect(sent).toContain(`${SENTINEL}:${kind}`);
      expect(aborted.events.at(-1)?.type).toBe('abort');
      expect(JSON.stringify(aborted.events)).toContain(`${SENTINEL}:delta`);
      expect(timedOut.events.at(-1)).toMatchObject({ type: 'error', code: 'timeout' });
      expect(JSON.stringify(timedOut.events)).toContain(`${SENTINEL}:delta`);
      expect(JSON.stringify([...(await loft.chat.getChatHistory(session.id))])).toContain(`${SENTINEL}:output`);

      const logged = Object.values(spy).flatMap((fn) => vi.mocked(fn).mock.calls);
      expect(logged.length).toBeGreaterThan(0);
      const leaking = (kind: string) =>
        logged.filter((args) => serialize(args).includes(`${SENTINEL}:${kind}`)).map((args) => String(args[0]));

      // Deltas, tool arguments, tool outputs and data payloads are never logged
      for (const kind of ['delta', 'args', 'output', 'data']) expect(leaking(kind), kind).toEqual([]);
      // The provider's error text is logged only by these error logs, which log the whole error object and are older
      // than streaming. Any other log line that carries it fails here.
      expect(leaking('error').map((message) => message.split(':')[0])).toEqual([
        'LLM request failed with error',
        'addHighPriorityTask failed',
        'callAndHandle() error',
        'generate() error'
      ]);
    });
  });
});

// A log call's arguments as text, with the message, stack and causes of errors, which JSON.stringify leaves out
function serialize(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'bigint') return item.toString();
    if (!item || typeof item !== 'object') return item;
    if (seen.has(item)) return '[circular]';
    seen.add(item);
    if (item instanceof Error) {
      return { ...item, name: item.name, message: item.message, stack: item.stack, cause: item.cause };
    }
    return item;
  });
}
