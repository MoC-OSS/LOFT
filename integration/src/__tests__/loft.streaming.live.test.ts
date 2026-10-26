import 'reflect-metadata';

import { Chat, ContextInterface, StandardMiddleware, Type } from '@moc-global/loft-definitions';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hasKeys } from './config';
import { initDB, type TestDatabaseInstance } from './initDB';
import { createChatConstructor, createLoftConstructor } from './loftInit';
import { initOpenAiStrategy } from './OpenAiStrategyWithCallManager';
import { textOf, userMessage } from './scriptedChat';

const LLM_NAME = 'gpt-4o-mini-streaming';
// The same model with a json_schema response format, which the OpenAI strategy does not stream
const JSON_SCHEMA_LLM_NAME = 'gpt-4o-mini-streaming-json-schema';

type StreamEvent = Chat.ChatStreamEvent;

function ofType<T extends StreamEvent['type']>(events: StreamEvent[], type: T) {
  return events.filter((event): event is Extract<StreamEvent, { type: T }> => event.type === type);
}

const TERMINAL = new Set(['finish', 'error', 'abort']);

// Every call numbers its events 0, 1, 2… and ends with exactly one terminal event
function expectWellFormed(events: StreamEvent[]) {
  expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
  expect(events.filter((event) => TERMINAL.has(event.type))).toHaveLength(1);
  expect(TERMINAL.has(events.at(-1)?.type ?? '')).toBe(true);
}

// An AfterGenerate middleware that changes the reply text
const shout: StandardMiddleware<ContextInterface, Chat.GenerateResultMessages> = async (_ctx, payload, chain) => {
  payload.llmResponse.topChoice.content = payload.llmResponse.topChoice.content.map((part) =>
    part.type === 'text' ? { ...part, text: part.text.toUpperCase() } : part
  );
  chain.next();
  return payload;
};

// An additional tool that reports progress through context.emit before it answers
const orderStatusTool: Chat.AdditionalTool = {
  definition: {
    name: 'get_order_status',
    description: 'Returns the delivery status of an order',
    inputSchema: {
      type: Chat.AdditionalToolSchemaType.OBJECT,
      properties: { orderId: { type: 'string', description: 'The order number' } },
      required: ['orderId']
    }
  },
  async handler(args, context) {
    context?.emit('progress', { stage: 'looking up' });
    return {
      content: [{ type: Chat.AdditionalToolContentType.TEXT, text: `Order ${String(args.orderId)}: shipped yesterday` }]
    };
  }
};

// Live: needs LOFT_OPENAI_API_KEY
describe.runIf(hasKeys('LOFT_OPENAI_API_KEY'))('Loft streaming with OpenAI (live)', () => {
  let testDb: TestDatabaseInstance;

  beforeAll(async () => {
    testDb = await initDB();
  }, 30000);

  afterAll(async () => {
    await testDb?.close();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
  });

  async function setup(
    options: { llmName?: string; configure?: (chatConstructor: ReturnType<typeof createChatConstructor>) => void } = {}
  ) {
    const llmName = options.llmName ?? LLM_NAME;
    const chatConstructor = createChatConstructor(testDb);
    const loftConstructor = createLoftConstructor(chatConstructor);
    await loftConstructor.registerLlmStrategy(llmName, initOpenAiStrategy(llmName));
    options.configure?.(chatConstructor);
    const loft = loftConstructor.getInstance();
    const session = await loft.chat.createSession({
      currentLlmName: llmName,
      currentManifestName: 'test-bot',
      ctx: {}
    });
    const ask = (text: string, generateOptions: Omit<Chat.GenerateOptions, 'sessionId' | 'directMessages'> = {}) =>
      loft.chat.generate({
        sessionId: session.id,
        directMessages: [{ ...userMessage(text, session.id), llmName, manifestName: 'test-bot' }],
        ...generateOptions
      });
    const savedReply = async () => {
      const history = [...(await loft.chat.getChatHistory(session.id))];
      return history.filter((message) => message.role === Type.LLM.UnifiedMessageRole.assistant).at(-1);
    };
    return { loft, session, ask, savedReply };
  }

  it('plain answer streams several text-deltas; finish.text equals the saved reply; seq has no gaps; one terminal event', async () => {
    const { ask, savedReply } = await setup();
    const events: StreamEvent[] = [];

    const result = await ask('Explain in five sentences what an abacus is and how people used it.', {
      onEvent: (event) => events.push(event)
    });
    await result.messages.save();

    expectWellFormed(events);
    expect(events[0]).toMatchObject({ type: 'start', textPolicy: 'all', streaming: true });
    const deltas = ofType(events, 'text-delta');
    expect(deltas.length).toBeGreaterThan(1);
    const [finish] = ofType(events, 'finish');
    expect(finish.text).toBe(deltas.map((event) => event.delta).join(''));
    expect(finish.textReplaced).toBe(false);
    expect(ofType(events, 'step-finish').map((event) => event.streamed)).toEqual([true]);

    const saved = await savedReply();
    expect(saved && textOf(saved)).toBe(finish.text);
  }, 60000);

  it('tool round (an additional tool that calls context.emit) emits tool-call, data, tool-result in step 0, text in step 1', async () => {
    const { ask } = await setup();
    const events: StreamEvent[] = [];

    await ask('What is the delivery status of order 42? Look it up with the get_order_status tool.', {
      additionalTools: [orderStatusTool],
      onEvent: (event) => events.push(event)
    });

    expectWellFormed(events);
    // One of each, so a model that skips the tool fails here rather than on an undefined event
    expect(ofType(events, 'tool-call')).toHaveLength(1);
    expect(ofType(events, 'data')).toHaveLength(1);
    expect(ofType(events, 'tool-result')).toHaveLength(1);
    const [toolCall] = ofType(events, 'tool-call');
    expect(toolCall).toMatchObject({ step: 0, name: 'get_order_status' });
    const [data] = ofType(events, 'data');
    expect(data).toMatchObject({
      step: 0,
      toolCallId: toolCall.toolCallId,
      toolName: 'get_order_status',
      name: 'progress',
      data: { stage: 'looking up' }
    });
    const [toolResult] = ofType(events, 'tool-result');
    expect(toolResult).toMatchObject({ step: 0, toolCallId: toolCall.toolCallId, status: 'succeeded' });
    // In execution order: the call, the data it sent, then its result
    expect(toolCall.seq).toBeLessThan(data.seq);
    expect(data.seq).toBeLessThan(toolResult.seq);
    expect(ofType(events, 'step-finish')[0]).toMatchObject({ step: 0, hadToolCalls: true });

    const answerDeltas = ofType(events, 'text-delta').filter((event) => event.step === 1);
    expect(answerDeltas.length).toBeGreaterThan(0);
    expect(ofType(events, 'finish')[0].text).toBe(answerDeltas.map((event) => event.delta).join(''));
  }, 60000);

  it('abort after the first text-delta: one abort event, generate rejects, nothing saved', async () => {
    const { loft, session, ask } = await setup();
    const controller = new AbortController();
    const events: StreamEvent[] = [];

    const generation = ask('Write a 400-word story about a lighthouse keeper.', {
      signal: controller.signal,
      onEvent: (event) => {
        events.push(event);
        if (event.type === 'text-delta') controller.abort();
      }
    });

    await expect(generation).rejects.toBeDefined();
    expectWellFormed(events);
    expect(ofType(events, 'abort')).toHaveLength(1);
    expect(ofType(events, 'text-delta')).toHaveLength(1);
    expect([...(await loft.chat.getChatHistory(session.id))]).toHaveLength(0);
  }, 60000);

  it('after-middleware policy with a transforming AfterGenerate middleware: no text-delta during steps, finish.text is the transformed text', async () => {
    const { ask } = await setup({
      configure: (chatConstructor) => chatConstructor.registerAfterGenerateMiddleware('shout', shout)
    });
    const events: StreamEvent[] = [];

    await ask('Name three planets of the solar system in one sentence.', { onEvent: (event) => events.push(event) });

    expectWellFormed(events);
    // Nothing would be streamed, so the provider is called as without onEvent
    expect(events[0]).toMatchObject({ type: 'start', textPolicy: 'after-middleware', streaming: false });
    const [finish] = ofType(events, 'finish');
    expect(finish.text).not.toBe('');
    expect(finish.text).toBe(finish.text.toUpperCase());
    // The only text-delta is the final text, sent in a step of its own after the model's step
    const deltas = ofType(events, 'text-delta');
    expect(deltas).toHaveLength(1);
    expect(deltas[0].delta).toBe(finish.text);
    const steps = ofType(events, 'step-finish');
    expect(steps.length).toBeGreaterThan(1);
    expect(deltas[0].step).toBe(steps.at(-1)?.step);
    expect(steps.every((event) => !event.streamed)).toBe(true);
  }, 60000);

  it('json_schema response_format falls back: one text-delta per step, step-finish.streamed false', async () => {
    const { ask } = await setup({ llmName: JSON_SCHEMA_LLM_NAME });
    const events: StreamEvent[] = [];

    await ask('What is the capital of France?', { onEvent: (event) => events.push(event) });

    expectWellFormed(events);
    const steps = ofType(events, 'step-finish');
    expect(steps.map((event) => event.streamed)).toEqual([false]);
    const deltas = ofType(events, 'text-delta');
    expect(deltas.map((event) => event.step)).toEqual(steps.map((event) => event.step));
    const [finish] = ofType(events, 'finish');
    expect(deltas[0].delta).toBe(finish.text);
    expect(JSON.parse(finish.text)).toEqual({ answer: expect.stringContaining('Paris') });
  }, 60000);

  it('usage on finish is non-zero', async () => {
    const { ask } = await setup();
    const events: StreamEvent[] = [];

    await ask('Say hello in one word.', { onEvent: (event) => events.push(event) });

    expectWellFormed(events);
    const [finish] = ofType(events, 'finish');
    expect(finish.usage.inputTokens).toBeGreaterThan(0);
    expect(finish.usage.outputTokens).toBeGreaterThan(0);
    expect(finish.usage.totalTokens).toBeGreaterThan(0);
    expect(finish.usage.model).toContain('gpt-4o-mini');
  }, 60000);
});
