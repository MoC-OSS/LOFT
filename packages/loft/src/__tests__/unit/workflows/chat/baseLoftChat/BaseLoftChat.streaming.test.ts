import 'reflect-metadata';

import {
  Agent,
  Chat,
  ContextInterface,
  createBeforeGenerateMiddlewareManager,
  createStandardMiddlewareManager,
  DI_TYPES,
  GenerateError,
  GenerateRequestParameters,
  Interface,
  Repository,
  SessionNotFoundError,
  StandardMiddleware,
  Strategy,
  Type
} from '@moc-global/loft-definitions';
import { configureSpyLoggerStrategy, ScriptedLLMStrategy, ScriptedReply } from '@moc-global/loft-test-suite';
import { Container } from 'inversify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NoOpTracerStrategy } from '../../../../../base-components';
import { FocusRegistry } from '../../../../../focus/FocusRegistry';
import { LoftHealthCheckInterface } from '../../../../../LoftHealthCheck';
import { LlmManager } from '../../../../../managers/LlmManager';
import { ToolInterceptorManager } from '../../../../../managers/ToolInterceptorManager';
import { ContextProvider } from '../../../../../providers/ContextProvider';
import { GenerateResultMessagesProvider } from '../../../../../providers/GenerateResultMessagesProvider';
import { ChatConfig } from '../../../../../types';
import { BaseLoftChat } from '../../../../../workflows/chat/BaseLoftChat';
import { ChatEventEmitter } from '../../../../../workflows/chat/streaming/ChatEventEmitter';

const LLM = 'scripted';
const MANIFEST = 'assistant';
const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const FOCUS = 'intake';

const logger = configureSpyLoggerStrategy();

// Whether a warning mentioned the text
const warned = (text: string): boolean =>
  vi.mocked(logger.warn).mock.calls.some(([message]) => String(message).includes(text));

type ChatEvent = Chat.ChatStreamEvent;
type EventOf<T extends ChatEvent['type']> = Extract<ChatEvent, { type: T }>;

function ofType<T extends ChatEvent['type']>(events: ChatEvent[], type: T): EventOf<T>[] {
  return events.filter((event): event is EventOf<T> => event.type === type);
}

// The event types in order, with the phase of status events, so a whole sequence reads at a glance
function sequence(events: ChatEvent[]): string[] {
  return events.map((event) => (event.type === 'status' ? `status:${event.phase}` : event.type));
}

const userMessage = (text: string): Type.Entity.CreateMessage => ({
  sessionId: SESSION_ID,
  ctx: {},
  content: [{ type: 'text', text }],
  role: Type.LLM.UnifiedMessageRole.user,
  author: 'user',
  llmName: LLM,
  manifestName: MANIFEST,
  llmIgnore: false
});

const textResult = (text: string): Chat.AdditionalToolResult => ({
  content: [{ type: Chat.AdditionalToolContentType.TEXT, text }]
});

const lookupOrder = (handler: Chat.AdditionalTool['handler']): Chat.AdditionalTool => ({
  definition: {
    name: 'lookup_order',
    description: 'Looks up an order',
    inputSchema: { type: Chat.AdditionalToolSchemaType.OBJECT, properties: { id: { type: 'string' } } }
  },
  handler
});

// An AfterGenerate middleware that changes the reply text
const shout: StandardMiddleware<ContextInterface, Chat.GenerateResultMessages> = async (_ctx, payload, chain) => {
  payload.llmResponse.topChoice.content = payload.llmResponse.topChoice.content.map((part) =>
    part.type === 'text' ? { ...part, text: part.text.toUpperCase() } : part
  );
  chain.next();
  return payload;
};

// An AfterGenerate middleware that only looks at the reply
const observe: typeof shout = async (_ctx, payload, chain) => {
  chain.next();
  return payload;
};

const focusConfig: Agent.Focus = {
  agentName: FOCUS,
  prompt: 'Collect the order number',
  fields: [{ key: 'orderId', type: Agent.FocusFieldType.STRING, required: true, description: 'Order number' }],
  onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'support' }
};

class SessionRepository implements Repository.Session {
  focus?: Agent.FocusStateStore;
  exists = true;
  readonly session: Type.Entity.Session = {
    id: SESSION_ID,
    ctx: {},
    currentLlmName: LLM,
    currentManifestName: MANIFEST,
    externalKey: { userId: 'user-1' },
    focusAgent: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z')
  };

  create = vi.fn();
  getByExternalKey = vi.fn();
  updateById = vi.fn(async () => this.session);
  deleteById = vi.fn();
  checkHealth = vi.fn();
  end = vi.fn();

  async getById(sessionId: string): Promise<Type.Entity.Session> {
    if (!this.exists) throw new SessionNotFoundError({ sessionId });
    return this.session;
  }
}

// Keeps what save() stores
class ChatHistoryManager implements Repository.ChatHistoryManager {
  readonly saved: Type.Entity.CreateMessage[][] = [];
  private nextId = 0;

  getMessages = vi.fn(async (): Promise<Type.Entity.Message[]> => []);
  patchMessages = vi.fn();
  checkHealth = vi.fn();
  end = vi.fn();

  addMessages = vi.fn(async (_sessionId: string, messages: Type.Entity.CreateMessage[]) => {
    this.saved.push(messages);
    return messages.map((message): Type.Entity.Message => ({
      ...message,
      id: `message-${++this.nextId}`,
      sequenceId: String(this.nextId),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z')
    }));
  });
}

interface SetupOptions {
  replies?: ScriptedReply[];
  chatConfig?: ChatConfig;
  /** Replaces the flush of the tracer each generate() call gets */
  flushAsync?: () => Promise<void>;
}

// A no-op tracer strategy whose tracers flush with the given function
function tracerStrategyFlushingWith(flushAsync?: () => Promise<void>): Strategy.Tracer.TracerFactory {
  const strategy = new NoOpTracerStrategy();
  if (!flushAsync) return strategy;
  const createTracer = strategy.createTracer.bind(strategy);
  vi.spyOn(strategy, 'createTracer').mockImplementation((params) =>
    Object.assign(createTracer(params), { flushAsync })
  );
  return strategy;
}

async function setup({ replies = [], chatConfig = {}, flushAsync }: SetupOptions = {}) {
  const llm = new ScriptedLLMStrategy(LLM, replies);
  const sessionRepository = new SessionRepository();
  const chatHistoryManager = new ChatHistoryManager();
  const config: ChatConfig = { ...chatConfig, mcp: { maxCallsPerGenerate: 5, ...chatConfig.mcp } };

  const manifestManager = {
    useLlmManifestSchema: vi.fn().mockResolvedValue(undefined),
    getLlmManifest: vi.fn().mockResolvedValue({ systemMessage: 'You help.', modelPreset: { model: 'scripted' } })
  } as unknown as Interface.ManifestManager;
  const computerManager = {
    compute: vi.fn().mockResolvedValue('You help.')
  } as unknown as Interface.ComputerManager<ContextInterface>;
  const mcpManager = {
    listTools: vi.fn().mockResolvedValue([]),
    callTool: vi.fn(),
    getClientsInfoForTool: vi.fn().mockResolvedValue(new Map())
  } as unknown as Interface.MCP.MCPManager;
  const cropper = {
    crop: (messages: Type.Entity.Message[]) => messages
  } as unknown as Strategy.LlmContextWindowCropper;

  const llmManager = new LlmManager(
    manifestManager,
    computerManager,
    computerManager,
    computerManager,
    mcpManager,
    cropper,
    new ToolInterceptorManager(),
    config
  );
  await llmManager.use(LLM, llm, false);

  const container = new Container();
  container.bind<Repository.Session>(DI_TYPES.SessionRepository).toConstantValue(sessionRepository);
  container.bind<Repository.ChatHistoryManager>(DI_TYPES.ChatHistoryManager).toConstantValue(chatHistoryManager);
  container.bind<Interface.LlmManager>(DI_TYPES.LlmManager).toConstantValue(llmManager);
  container.bind(DI_TYPES.TracerStrategy).toConstantValue(tracerStrategyFlushingWith(flushAsync));

  const input = createStandardMiddlewareManager<ContextInterface, GenerateRequestParameters>('input');
  const beforeGenerate = createBeforeGenerateMiddlewareManager<ContextInterface, GenerateRequestParameters>(
    'beforeGenerate'
  );
  const afterGenerate = createStandardMiddlewareManager<ContextInterface, Chat.GenerateResultMessages>('afterGenerate');
  const focusRegistry = new FocusRegistry();
  focusRegistry.register(FOCUS, focusConfig);
  const healthCheck: LoftHealthCheckInterface = { check: vi.fn() };

  const chat = new BaseLoftChat(
    sessionRepository,
    chatHistoryManager,
    new ContextProvider(container, config),
    llmManager,
    config,
    healthCheck,
    input,
    beforeGenerate,
    afterGenerate,
    new GenerateResultMessagesProvider(chatHistoryManager),
    focusRegistry
  );

  const events: ChatEvent[] = [];
  const onEvent = (event: ChatEvent) => {
    events.push(event);
  };
  const ask = (options: Partial<Chat.GenerateOptions> = {}) =>
    chat.generate({ sessionId: SESSION_ID, directMessages: [userMessage('Where is my order?')], ...options });

  return {
    chat,
    llm,
    llmManager,
    sessionRepository,
    chatHistoryManager,
    input,
    beforeGenerate,
    afterGenerate,
    events,
    onEvent,
    ask
  };
}

// The data of a value, without its functions (each message holds its own save function)
function serialised(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

// What a caller can observe of a result, without the context: it holds a tracer with a random id
function observable(result: Chat.GenerateResult): unknown {
  const { ctx: _ctx, ...rest } = result;
  return serialised(rest);
}

describe('BaseLoftChat generation events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generate without onEvent is unchanged', async () => {
    const reply: ScriptedReply = { text: 'Your order shipped', chunks: ['Your order', ' shipped'] };
    const plain = await setup({ replies: [reply] });
    const streamed = await setup({ replies: [reply] });

    const plainResult = await plain.ask();
    await plainResult.messages.save();
    const streamedResult = await streamed.ask({ onEvent: streamed.onEvent });
    await streamedResult.messages.save();

    expect(streamed.events.length).toBeGreaterThan(0);
    expect(observable(streamedResult)).toEqual(observable(plainResult));
    expect(serialised(streamed.chatHistoryManager.saved)).toEqual(serialised(plain.chatHistoryManager.saved));
    expect(streamedResult.messages.llmResponse.usage).toEqual(plainResult.messages.llmResponse.usage);
  });

  it('streamOptions without onEvent are ignored', async () => {
    const { ask, llm, llmManager } = await setup({ replies: [{ text: 'Hi', chunks: ['H', 'i'] }] });
    const managerGenerate = vi.spyOn(llmManager, 'generate');
    const strategyGenerate = vi.spyOn(llm, 'generate');

    const result = await ask({ streamOptions: { enabled: true, textPolicy: 'all' } });

    expect(result.status).toBe(Chat.Status.SUCCESS);
    // No events key at all, so the manager runs as without streaming
    expect(Object.keys(managerGenerate.mock.calls[0][6] ?? {})).toEqual(['signal']);
    expect(strategyGenerate.mock.calls[0][1]?.onEvent).toBeUndefined();
  });

  describe('pre-flight failures emit nothing', () => {
    it('when the response was already generated', async () => {
      const { ask, events, onEvent } = await setup();

      const failure = ask({ onEvent, directMessages: [] });

      await expect(failure).rejects.toBeInstanceOf(GenerateError);
      await expect(failure).rejects.toMatchObject({ status: Chat.Status.ALREADY_GENERATED });
      expect(events).toEqual([]);
    });

    it('when an input middleware throws', async () => {
      const { ask, events, onEvent, input } = await setup({ replies: [{ text: 'unused' }] });
      input.use('reject-input', async () => {
        throw new Error('input refused');
      });

      await expect(ask({ onEvent })).rejects.toThrow();
      expect(events).toEqual([]);
    });

    it('when the session does not exist', async () => {
      const { ask, events, onEvent, sessionRepository } = await setup({ replies: [{ text: 'unused' }] });
      sessionRepository.exists = false;

      await expect(ask({ onEvent })).rejects.toBeInstanceOf(SessionNotFoundError);
      expect(events).toEqual([]);
    });

    it('when a BeforeGenerate middleware throws', async () => {
      const { ask, events, onEvent, beforeGenerate, llm } = await setup({ replies: [{ text: 'unused' }] });
      beforeGenerate.use('reject-request', async () => {
        throw new Error('request refused');
      });

      await expect(ask({ onEvent })).rejects.toBeInstanceOf(GenerateError);
      expect(events).toEqual([]);
      expect(llm.calls).toHaveLength(0);
    });

    it('when the LLM name is unknown', async () => {
      const { ask, events, onEvent } = await setup({ replies: [{ text: 'unused' }] });

      await expect(ask({ onEvent, temporaryLlmName: 'not-registered' })).rejects.toBeInstanceOf(GenerateError);
      expect(events).toEqual([]);
    });
  });

  it('start then finish with authoritative text', async () => {
    const { ask, events, onEvent } = await setup({
      replies: [{ text: 'Your order shipped', chunks: ['Your order', ' shipped'] }]
    });

    const result = await ask({ onEvent });

    expect(sequence(events)).toEqual([
      'start',
      'step-start',
      'status:queued',
      'status:generating',
      'text-delta',
      'text-delta',
      'step-finish',
      'finish'
    ]);
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
    expect(events[0]).toMatchObject({ type: 'start', sessionId: SESSION_ID, textPolicy: 'all', streaming: true });
    expect(ofType(events, 'text-delta').map((event) => event.delta)).toEqual(['Your order', ' shipped']);
    expect(ofType(events, 'step-finish')[0]).toMatchObject({ step: 0, streamed: true, hadToolCalls: false });
    expect(events.at(-1)).toEqual({
      type: 'finish',
      seq: 7,
      runId: events[0].runId,
      reason: 'stop',
      finishReason: 'stop',
      text: 'Your order shipped',
      textReplaced: false,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, model: 'scripted', finishReason: 'stop' }
    });
    expect(result.messages.llmResponse.topChoice.content).toEqual([{ type: 'text', text: 'Your order shipped' }]);
  });

  it('runId is the same on every event of one call and differs between calls', async () => {
    const { ask, events, onEvent } = await setup({ replies: [{ text: 'One' }, { text: 'Two' }] });

    await ask({ onEvent });
    const firstCall = events.splice(0);
    await ask({ onEvent });

    expect(new Set(firstCall.map((event) => event.runId)).size).toBe(1);
    expect(new Set(events.map((event) => event.runId)).size).toBe(1);
    expect(events[0].runId).not.toBe(firstCall[0].runId);
    // Each call counts from 0
    expect(events[0].seq).toBe(0);
  });

  describe('text policy', () => {
    it('after-middleware by default with a transforming AfterGenerate middleware', async () => {
      const { ask, events, onEvent, afterGenerate } = await setup({
        replies: [{ text: 'Your order shipped', chunks: ['Your order', ' shipped'] }]
      });
      afterGenerate.use('shout-default-policy', shout);

      const result = await ask({ onEvent });

      expect(events[0]).toMatchObject({ type: 'start', textPolicy: 'after-middleware', streaming: false });
      expect(sequence(events)).toEqual([
        'start',
        'step-start',
        'status:queued',
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
      expect(ofType(events, 'text-delta').map((event) => event.delta)).toEqual(['YOUR ORDER SHIPPED']);
      expect(events.at(-1)).toMatchObject({ type: 'finish', text: 'YOUR ORDER SHIPPED', textReplaced: false });
      expect(result.messages.llmResponse.topChoice.content).toEqual([{ type: 'text', text: 'YOUR ORDER SHIPPED' }]);
      expect(warned('shout-default-policy')).toBe(true);
    });

    it('transformsOutput false keeps streaming', async () => {
      const { ask, events, onEvent, afterGenerate } = await setup({
        replies: [{ text: 'Your order shipped', chunks: ['Your order', ' shipped'] }]
      });
      afterGenerate.use('audit-only', observe, { transformsOutput: false });

      await ask({ onEvent });

      expect(events[0]).toMatchObject({ type: 'start', textPolicy: 'all', streaming: true });
      expect(ofType(events, 'text-delta').map((event) => event.delta)).toEqual(['Your order', ' shipped']);
      expect(warned('audit-only')).toBe(false);
    });

    it('explicit textPolicy all streams despite middleware', async () => {
      const { ask, events, onEvent, afterGenerate } = await setup({
        replies: [{ text: 'Your order shipped', chunks: ['Your order', ' shipped'] }]
      });
      afterGenerate.use('shout-explicit-policy', shout);

      await ask({ onEvent, streamOptions: { textPolicy: 'all' } });

      expect(events[0]).toMatchObject({ type: 'start', textPolicy: 'all', streaming: true });
      expect(ofType(events, 'text-delta').map((event) => event.delta)).toEqual(['Your order', ' shipped']);
      // finish carries the text after the middleware, which differs from what was streamed
      expect(events.at(-1)).toMatchObject({ type: 'finish', text: 'YOUR ORDER SHIPPED', textReplaced: true });
      expect(warned('shout-explicit-policy')).toBe(false);
    });

    it('the call options are merged over the chat config', async () => {
      const { ask, events, onEvent } = await setup({
        replies: [{ text: 'Your order shipped', chunks: ['Your order', ' shipped'] }],
        chatConfig: { streaming: { textPolicy: 'after-middleware', include: { toolCalls: 'none' } } }
      });

      await ask({ onEvent, streamOptions: { textPolicy: 'all' } });

      expect(events[0]).toMatchObject({ type: 'start', textPolicy: 'all', streaming: true });
      expect(ofType(events, 'text-delta')).toHaveLength(2);
    });

    it('strategy without hasOutputMiddleware counts as middleware', async () => {
      const { ask, events, onEvent, llm } = await setup({
        replies: [{ text: 'Your order shipped', chunks: ['Your order', ' shipped'] }]
      });
      Object.defineProperty(llm, 'hasOutputMiddleware', { value: undefined });

      await ask({ onEvent });

      // Held until the end: the step streams nothing, and the text comes once, with finish
      expect(ofType(events, 'step-finish')[0]).toMatchObject({ step: 0, streamed: false });
      expect(ofType(events, 'text-delta')).toEqual([expect.objectContaining({ step: 1, delta: 'Your order shipped' })]);
      expect(warned('<strategy:unknown>')).toBe(true);
    });

    it('start.textPolicy is after-middleware for a strategy without hasOutputMiddleware', async () => {
      const { ask, events, onEvent, llm } = await setup({ replies: [{ text: 'Hi' }] });
      Object.defineProperty(llm, 'hasOutputMiddleware', { value: undefined });

      await ask({ onEvent });

      expect(events[0]).toMatchObject({ type: 'start', textPolicy: 'after-middleware', streaming: false });
    });

    it('the strategy of a temporary LLM decides the policy, not the session one', async () => {
      const { ask, events, onEvent, llm, llmManager } = await setup({ replies: [{ text: 'unused' }] });
      const redacting = new ScriptedLLMStrategy('scripted-redacting', [{ text: 'Hi', chunks: ['H', 'i'] }]);
      redacting.useMiddleware('redact-temporary', async (_ctx, response, chain) => {
        chain.next();
        return response;
      });
      await llmManager.use('scripted-redacting', redacting, false);

      await ask({ onEvent, temporaryLlmName: 'scripted-redacting' });

      expect(llm.hasOutputMiddleware()).toBe(false);
      expect(redacting.calls).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'start', textPolicy: 'after-middleware' });
      expect(warned('<strategy:scripted-redacting>')).toBe(true);
    });

    it("a strategy's transforming middleware holds text back under the strategy's name", async () => {
      const { ask, events, onEvent, llm } = await setup({ replies: [{ text: 'Hi', chunks: ['H', 'i'] }] });
      llm.useMiddleware('redact', async (_ctx, response, chain) => {
        chain.next();
        return response;
      });

      await ask({ onEvent });

      expect(events[0]).toMatchObject({ type: 'start', textPolicy: 'after-middleware' });
      expect(warned(`<strategy:${LLM}>`)).toBe(true);
    });
  });

  it('preventGeneration text passes AfterGenerate before it is emitted', async () => {
    const { ask, events, onEvent, beforeGenerate, afterGenerate, llm } = await setup();
    const markSynthetic = vi.spyOn(ChatEventEmitter.prototype, 'markSynthetic');
    // The strategy is not asked when generation is prevented, so it does not decide the policy
    Object.defineProperty(llm, 'hasOutputMiddleware', { value: undefined });
    beforeGenerate.use('canned-reply', async (_ctx, payload, chain) => {
      chain.preventGeneration({
        content: [{ type: 'text', text: 'We are closed today' }],
        role: Type.LLM.UnifiedMessageRole.assistant
      });
      return payload;
    });
    afterGenerate.use('shout-canned', shout, { transformsOutput: false });

    await ask({ onEvent });

    expect(llm.calls).toHaveLength(0);
    expect(markSynthetic).toHaveBeenCalledTimes(1);
    expect(events[0]).toMatchObject({ type: 'start', textPolicy: 'all' });
    expect(sequence(events)).toEqual([
      'start',
      'step-start',
      'status:queued',
      'status:generating',
      'text-delta',
      'step-finish',
      'finish'
    ]);
    expect(ofType(events, 'text-delta')[0].delta).toBe('WE ARE CLOSED TODAY');
    expect(events.at(-1)).toMatchObject({
      type: 'finish',
      text: 'WE ARE CLOSED TODAY',
      finishReason: 'middleware_override',
      textReplaced: false
    });
    expect(JSON.stringify(events)).not.toContain('We are closed today');
  });

  it('loop limit end to end: empty text, max_loops_exceeded', async () => {
    const { ask, events, onEvent } = await setup({
      replies: [
        { toolCalls: [{ name: 'lookup_order', arguments: { id: '1' } }] },
        { toolCalls: [{ name: 'lookup_order', arguments: { id: '2' } }] }
      ],
      chatConfig: { mcp: { maxCallsPerGenerate: 2 } }
    });

    const result = await ask({ onEvent, additionalTools: [lookupOrder(async () => textResult('Order 1 shipped'))] });

    expect(events.at(-1)).toMatchObject({ type: 'finish', finishReason: 'max_loops_exceeded', text: '' });
    expect(ofType(events, 'finish')).toHaveLength(1);
    expect(ofType(events, 'text-delta')).toEqual([]);
    // The result keeps LOFT's limit message; the caller's events never carry it
    expect(result.messages.llmResponse.usage.finishReason).toBe('max_loops_exceeded');
    expect(JSON.stringify(events)).not.toContain('limit reached');
  });

  it('data events from an additional tool arrive between tool-call and tool-result', async () => {
    const { ask, events, onEvent } = await setup({
      replies: [
        { toolCalls: [{ name: 'lookup_order', arguments: { id: '42' }, callId: 'call-1' }] },
        { text: 'Shipped' }
      ]
    });
    const tool = lookupOrder(async (_args, context) => {
      context?.emit('progress', { percent: 50 });
      return textResult('Order 42 shipped');
    });

    await ask({ onEvent, additionalTools: [tool] });

    expect(sequence(events).filter((type) => ['tool-call', 'data', 'tool-result'].includes(type))).toEqual([
      'tool-call',
      'data',
      'tool-result'
    ]);
    expect(ofType(events, 'data')[0]).toMatchObject({
      step: 0,
      toolCallId: 'call-1',
      toolName: 'lookup_order',
      name: 'progress',
      data: { percent: 50 }
    });
    expect(events.at(-1)).toMatchObject({ type: 'finish', text: 'Shipped' });
  });

  it('provider error: fixed-message error event, generate rejects', async () => {
    const providerError = Object.assign(new Error('upstream said something private'), { status: 500 });
    const { ask, events, onEvent } = await setup({ replies: [{ error: providerError }] });

    const failure = ask({ onEvent });

    await expect(failure).rejects.toBeInstanceOf(GenerateError);
    await expect(failure).rejects.toMatchObject({ cause: providerError });
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      code: 'provider_error',
      message: 'The model provider returned an error.'
    });
    expect(ofType(events, 'error')).toHaveLength(1);
    expect(ofType(events, 'finish')).toEqual([]);
    expect(JSON.stringify(events)).not.toContain('private');
  });

  it('abort after tool result ends with a single abort', async () => {
    const controller = new AbortController();
    const { ask, events, onEvent } = await setup({
      replies: [{ toolCalls: [{ name: 'lookup_order', arguments: { id: '42' } }] }, { waitForAbort: true }]
    });
    const tool = lookupOrder(async () => {
      controller.abort();
      return textResult('Order 42 shipped');
    });

    const failure = ask({ onEvent, signal: controller.signal, additionalTools: [tool] });

    await expect(failure).rejects.toBeInstanceOf(GenerateError);
    await expect(failure).rejects.toMatchObject({ cause: { name: 'AbortError' } });

    expect(sequence(events)).toContain('tool-result');
    expect(ofType(events, 'abort')).toEqual([expect.objectContaining({ reason: 'cancelled' })]);
    expect(events.at(-1)?.type).toBe('abort');
    expect(ofType(events, 'error')).toEqual([]);
    expect(ofType(events, 'finish')).toEqual([]);
  });

  it('abort by a timeout signal says timeout', async () => {
    const { ask, events, onEvent } = await setup({ replies: [{ waitForAbort: true }] });

    await expect(ask({ onEvent, signal: AbortSignal.timeout(20) })).rejects.toBeInstanceOf(GenerateError);

    expect(events.at(-1)).toMatchObject({ type: 'abort', reason: 'timeout' });
    expect(ofType(events, 'abort')).toHaveLength(1);
  });

  it('abort mid-stream after deltas', async () => {
    const controller = new AbortController();
    const { ask, events } = await setup({
      replies: [{ text: 'Your order shipped', chunks: ['Your order', ' shipped'], waitForAbortAfterChunks: true }]
    });
    const onEvent = (event: ChatEvent) => {
      events.push(event);
      if (ofType(events, 'text-delta').length === 2 && event.type === 'text-delta') controller.abort();
    };

    const failure = ask({ onEvent, signal: controller.signal });

    await expect(failure).rejects.toBeInstanceOf(GenerateError);
    await expect(failure).rejects.toMatchObject({ cause: { name: 'AbortError' } });

    expect(sequence(events)).toEqual([
      'start',
      'step-start',
      'status:queued',
      'status:generating',
      'text-delta',
      'text-delta',
      'abort'
    ]);
  });

  it('Focus post-processing failure after the LLM yields error, never finish then error', async () => {
    const { ask, events, onEvent, sessionRepository, chatHistoryManager } = await setup({
      replies: [{ text: 'What is your order number?', chunks: ['What is', ' your order number?'] }]
    });
    let reads = 0;
    const store: Agent.FocusStateStore = {
      get: vi.fn(),
      // The first read builds the prompt; the second, after the LLM, fails
      getAll: vi.fn(async () => {
        reads += 1;
        if (reads > 1) throw new Error('store unavailable');
        return {};
      }),
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      clearAll: vi.fn()
    };
    sessionRepository.focus = store;

    await expect(ask({ onEvent, focusAgent: FOCUS })).rejects.toBeInstanceOf(GenerateError);

    expect(ofType(events, 'text-delta')).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'internal' });
    expect(ofType(events, 'finish')).toEqual([]);
    expect(chatHistoryManager.saved).toEqual([]);
  });

  describe('tracer flush', () => {
    it('finish arrives while a slow flush is still pending', async () => {
      let endFlush!: () => void;
      const flushAsync = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            endFlush = resolve;
          })
      );
      let finished!: () => void;
      const finishSeen = new Promise<void>((resolve) => {
        finished = resolve;
      });
      const { ask, events } = await setup({ replies: [{ text: 'Your order shipped' }], flushAsync });
      const onEvent = (event: ChatEvent) => {
        events.push(event);
        if (event.type === 'finish') finished();
      };
      let settled = false;

      const pending = ask({ onEvent }).finally(() => {
        settled = true;
      });
      await finishSeen;

      expect(events.at(-1)).toMatchObject({ type: 'finish', text: 'Your order shipped' });
      expect(flushAsync).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);

      endFlush();
      await expect(pending).resolves.toMatchObject({ status: Chat.Status.SUCCESS });
      expect(ofType(events, 'finish')).toHaveLength(1);
    });

    it('a failed flush is logged and generate still resolves, with or without onEvent', async () => {
      const flushAsync = vi.fn(async () => {
        throw new Error('tracing backend down SENTINEL-flush');
      });
      const streamed = await setup({ replies: [{ text: 'Your order shipped' }], flushAsync });
      const plain = await setup({ replies: [{ text: 'Your order shipped' }], flushAsync });

      await expect(streamed.ask({ onEvent: streamed.onEvent })).resolves.toMatchObject({
        status: Chat.Status.SUCCESS
      });
      await expect(plain.ask()).resolves.toMatchObject({ status: Chat.Status.SUCCESS });

      expect(sequence(streamed.events).slice(-1)).toEqual(['finish']);
      expect(ofType(streamed.events, 'error')).toEqual([]);
      // Once per call, on the success path only
      expect(flushAsync).toHaveBeenCalledTimes(2);
      expect(warned('Failed to flush tracer after generate')).toBe(true);
      expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('SENTINEL-flush');
    });
  });

  it('fallback for a strategy that ignores onEvent', async () => {
    // A reply without chunks: the scripted strategy answers at once and sends no events
    const { ask, events, onEvent } = await setup({ replies: [{ text: 'Your order shipped' }] });

    await ask({ onEvent });

    expect(events[0]).toMatchObject({ type: 'start', streaming: true });
    expect(ofType(events, 'text-delta')).toEqual([expect.objectContaining({ step: 0, delta: 'Your order shipped' })]);
    expect(ofType(events, 'step-finish')[0]).toMatchObject({ step: 0, streamed: false });
    expect(events.at(-1)).toMatchObject({ type: 'finish', text: 'Your order shipped', textReplaced: false });
  });

  it('enabled false is observe-only', async () => {
    const { ask, events, onEvent, llm } = await setup({
      replies: [{ text: 'Your order shipped', chunks: ['Your order', ' shipped'] }],
      chatConfig: { streaming: { enabled: false } }
    });
    const strategyGenerate = vi.spyOn(llm, 'generate');

    await ask({ onEvent });

    // The provider makes today's call, without a sink
    expect(strategyGenerate.mock.calls[0][1]?.onEvent).toBeUndefined();
    expect(events[0]).toMatchObject({ type: 'start', textPolicy: 'all', streaming: false });
    expect(ofType(events, 'text-delta').map((event) => event.delta)).toEqual(['Your order shipped']);
    expect(ofType(events, 'step-finish')[0]).toMatchObject({ streamed: false });
    expect(events.at(-1)).toMatchObject({ type: 'finish', text: 'Your order shipped' });
  });

  it('shutdown waits and the stream still ends with finish', async () => {
    const { chat, ask, events } = await setup({
      replies: [{ text: 'Your order shipped', chunks: ['Your', ' order', ' shipped'], chunkDelayMs: 20 }]
    });
    const order: string[] = [];
    let firstDelta!: () => void;
    const streaming = new Promise<void>((resolve) => {
      firstDelta = resolve;
    });
    const onEvent = (event: ChatEvent) => {
      events.push(event);
      order.push(event.type);
      if (event.type === 'text-delta') firstDelta();
    };

    const pending = ask({ onEvent });
    await streaming;
    await chat.shutdown();
    order.push('shutdown-done');
    const result = await pending;

    expect(result.status).toBe(Chat.Status.SUCCESS);
    expect(events.at(-1)).toMatchObject({ type: 'finish', text: 'Your order shipped' });
    expect(ofType(events, 'abort')).toEqual([]);
    expect(order.slice(-2)).toEqual(['finish', 'shutdown-done']);
  });
});
