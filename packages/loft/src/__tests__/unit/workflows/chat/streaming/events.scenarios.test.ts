import 'reflect-metadata';

import {
  Chat,
  ContextInterface,
  createBeforeGenerateMiddlewareManager,
  createStandardMiddlewareManager,
  DI_TYPES,
  GenerateError,
  GenerateRequestParameters,
  Interface,
  Repository,
  StandardMiddleware,
  Strategy,
  Type
} from '@moc-global/loft-definitions';
import {
  configureSpyLoggerStrategy,
  ScriptedLLMStrategy,
  ScriptedReply,
  ScriptedTurn
} from '@moc-global/loft-test-suite';
import { Container } from 'inversify';
import { describe, expect, it, vi } from 'vitest';

import { NoOpTracerStrategy } from '../../../../../base-components';
import { FocusRegistry } from '../../../../../focus/FocusRegistry';
import { LoftHealthCheckInterface } from '../../../../../LoftHealthCheck';
import { LlmManager } from '../../../../../managers/LlmManager';
import { ToolInterceptorManager } from '../../../../../managers/ToolInterceptorManager';
import { ContextProvider } from '../../../../../providers/ContextProvider';
import { GenerateResultMessagesProvider } from '../../../../../providers/GenerateResultMessagesProvider';
import { ChatConfig } from '../../../../../types';
import { BaseLoftChat } from '../../../../../workflows/chat/BaseLoftChat';

// Event-sequence invariants of chat.generate() with onEvent, checked over a matrix of text policies, tool shapes,
// outcomes and include options. Each scenario runs one generate() call against the scripted model.

configureSpyLoggerStrategy();

const LLM = 'scripted';
const MANIFEST = 'assistant';
const SESSION_ID = '00000000-0000-4000-8000-000000000002';

type ChatEvent = Chat.ChatStreamEvent;
type EventOf<T extends ChatEvent['type']> = Extract<ChatEvent, { type: T }>;

function ofType<T extends ChatEvent['type']>(events: ChatEvent[], type: T): EventOf<T>[] {
  return events.filter((event): event is EventOf<T> => event.type === type);
}

const TERMINAL_TYPES: ReadonlyArray<ChatEvent['type']> = ['finish', 'error', 'abort'];

// ---- The matrix ----

const POLICIES = ['all', 'after-middleware', 'observe-only'] as const;
const TOOL_SHAPES = [
  'no tools',
  'one tool',
  'parallel tools',
  'unsupported tool',
  'tool throws',
  'tool emits data before result',
  'tool emits data after result'
] as const;
const OUTCOMES = [
  'success',
  'provider error before deltas',
  'provider error after deltas',
  'abort before start',
  'abort during deltas',
  'abort between tools',
  'abort after last tool',
  'provider error in the tool step',
  'abort during the tool step',
  'abort while a tool runs',
  'abort after the last step'
] as const;
const TOOL_CALL_OPTIONS = ['none', 'names', 'args'] as const;

type Policy = (typeof POLICIES)[number];
type ToolShape = (typeof TOOL_SHAPES)[number];
type Outcome = (typeof OUTCOMES)[number];
type ToolCallOption = (typeof TOOL_CALL_OPTIONS)[number];

interface Scenario {
  name: string;
  policy: Policy;
  tools: ToolShape;
  outcome: Outcome;
  reasoning: boolean;
  toolCalls: ToolCallOption;
}

// A tool call the scripted model makes, and what its handler does
interface PlannedTool {
  name: string;
  callId: string;
  args: Record<string, unknown>;
  kind: 'succeeds' | 'throws' | 'unsupported';
}

const LOOKUP = { name: 'lookup_order', callId: 'call-a', args: { id: '42' } };
const STOCK = { name: 'check_stock', callId: 'call-b', args: { sku: 'A-1' } };
// The name and arguments the model makes up must never reach the caller
const MADE_UP = { name: 'made_up_tool', callId: 'call-x', args: { secret: 'model-invented-value' } };

function plannedTools(shape: ToolShape): PlannedTool[] {
  switch (shape) {
    case 'no tools':
      return [];
    case 'one tool':
      return [{ ...LOOKUP, kind: 'succeeds' }];
    case 'unsupported tool':
      return [
        { ...MADE_UP, kind: 'unsupported' },
        { ...LOOKUP, kind: 'succeeds' }
      ];
    case 'tool throws':
      return [
        { ...LOOKUP, kind: 'throws' },
        { ...STOCK, kind: 'succeeds' }
      ];
    case 'parallel tools':
    case 'tool emits data before result':
    case 'tool emits data after result':
      return [
        { ...LOOKUP, kind: 'succeeds' },
        { ...STOCK, kind: 'succeeds' }
      ];
  }
}

// Whether the provider gets a sink: text is streamed, or reasoning is, and streaming is on
function providerStreams(scenario: Pick<Scenario, 'policy' | 'reasoning'>): boolean {
  if (scenario.policy === 'observe-only') return false;
  if (scenario.policy === 'after-middleware') return scenario.reasoning;
  return true;
}

function handlerCount(shape: ToolShape): number {
  return plannedTools(shape).filter((tool) => tool.kind !== 'unsupported').length;
}

// Combinations that cannot happen: an abort between tools needs two tools that run, an abort after the last tool
// needs one, the tool step needs tools, and the scripted model fails after its chunks only when it streams them
function applicable(scenario: Omit<Scenario, 'name'>): boolean {
  switch (scenario.outcome) {
    case 'abort between tools':
      return handlerCount(scenario.tools) >= 2;
    case 'abort after last tool':
    case 'abort while a tool runs':
      return handlerCount(scenario.tools) >= 1;
    case 'provider error in the tool step':
    case 'abort during the tool step':
      return scenario.tools !== 'no tools';
    case 'provider error after deltas':
      return providerStreams(scenario);
    default:
      return true;
  }
}

function buildMatrix(): Scenario[] {
  const scenarios: Scenario[] = [];
  for (const policy of POLICIES) {
    for (const reasoning of [false, true]) {
      for (const toolCalls of TOOL_CALL_OPTIONS) {
        for (const tools of TOOL_SHAPES) {
          for (const outcome of OUTCOMES) {
            const scenario = { policy, reasoning, toolCalls, tools, outcome };
            if (!applicable(scenario)) continue;
            scenarios.push({
              ...scenario,
              name: `${policy} | ${tools} | ${outcome} | reasoning ${reasoning ? 'on' : 'off'} | toolCalls ${toolCalls}`
            });
          }
        }
      }
    }
  }
  return scenarios;
}

// Scenarios that fail today. Each one is a finding, kept as a failing test until it is fixed.
// Scenario name -> short description of the finding. Empty: every matrix scenario passes today.
const KNOWN_FAILURES = new Map<string, string>([]);

// ---- The chat under test ----

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

const toolDefinition = (name: string): Chat.AdditionalTool['definition'] => ({
  name,
  description: `The ${name} tool`,
  inputSchema: { type: Chat.AdditionalToolSchemaType.OBJECT, properties: {} }
});

// An AfterGenerate middleware that changes the reply text, so finish.text differs from the streamed text
const shout: StandardMiddleware<ContextInterface, Chat.GenerateResultMessages> = async (_ctx, payload, chain) => {
  payload.llmResponse.topChoice.content = payload.llmResponse.topChoice.content.map((part) =>
    part.type === 'text' ? { ...part, text: part.text.toUpperCase() } : part
  );
  chain.next();
  return payload;
};

class SessionRepository implements Repository.Session {
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

  async getById(): Promise<Type.Entity.Session> {
    return this.session;
  }
}

// Keeps what save() stores
class ChatHistoryManager implements Repository.ChatHistoryManager {
  readonly saved: Type.Entity.CreateMessage[] = [];
  private nextId = 0;

  getMessages = vi.fn(async (): Promise<Type.Entity.Message[]> => []);
  patchMessages = vi.fn();
  checkHealth = vi.fn();
  end = vi.fn();

  addMessages = vi.fn(async (_sessionId: string, messages: Type.Entity.CreateMessage[]) => {
    this.saved.push(...messages);
    return messages.map((message): Type.Entity.Message => ({
      ...message,
      id: `message-${++this.nextId}`,
      sequenceId: String(this.nextId),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z')
    }));
  });
}

async function createChat(replies: ScriptedReply[], maxCallsPerGenerate = 5) {
  const llm = new ScriptedLLMStrategy(LLM, replies);
  const sessionRepository = new SessionRepository();
  const chatHistoryManager = new ChatHistoryManager();
  const config: ChatConfig = { mcp: { maxCallsPerGenerate } };

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
  container.bind(DI_TYPES.TracerStrategy).toConstantValue(new NoOpTracerStrategy());

  const afterGenerate = createStandardMiddlewareManager<ContextInterface, Chat.GenerateResultMessages>('afterGenerate');
  afterGenerate.use('shout', shout);
  const healthCheck: LoftHealthCheckInterface = { check: vi.fn() };

  const chat = new BaseLoftChat(
    sessionRepository,
    chatHistoryManager,
    new ContextProvider(container, config),
    llmManager,
    config,
    healthCheck,
    createStandardMiddlewareManager<ContextInterface, GenerateRequestParameters>('input'),
    createBeforeGenerateMiddlewareManager<ContextInterface, GenerateRequestParameters>('beforeGenerate'),
    afterGenerate,
    new GenerateResultMessagesProvider(chatHistoryManager),
    new FocusRegistry()
  );

  return { chat, llm, chatHistoryManager };
}

// ---- One scenario run ----

const TOOL_STEP_TEXT = 'Let me check';
const TOOL_STEP_CHUNKS = ['Let me', ' check'];
const FINAL_TEXT = 'Your order shipped';
const FINAL_CHUNKS = ['Your', ' order', ' shipped'];
const DATA_MARKER = 'data-payload-marker';

interface Run {
  events: ChatEvent[];
  result?: Chat.GenerateResult;
  failure?: unknown;
  providerError: Error;
  // The tool handlers that ran, in order
  handlersRun: string[];
  // Events that arrived after generate() settled and the late emits were called
  eventsAfterSettle: number;
  // Whether each provider call got a sink
  providerSinks: boolean[];
  chatHistoryManager: ChatHistoryManager;
  llmCalls: number;
}

function streamOptionsOf(scenario: Pick<Scenario, 'policy' | 'reasoning' | 'toolCalls'>): Chat.StreamOptions {
  const include = { reasoning: scenario.reasoning, toolCalls: scenario.toolCalls };
  switch (scenario.policy) {
    case 'all':
      return { textPolicy: 'all', include };
    case 'after-middleware':
      return { textPolicy: 'after-middleware', include };
    case 'observe-only':
      return { enabled: false, textPolicy: 'all', include };
  }
}

async function runScenario(scenario: Scenario): Promise<Run> {
  const controller = new AbortController();
  const tools = plannedTools(scenario.tools);
  const streams = providerStreams(scenario);
  const providerError = Object.assign(new Error('upstream said something private'), { status: 500 });
  const handlersRun: string[] = [];
  // The emit functions of tools that already returned, called again later
  const capturedEmits: Array<Chat.AdditionalToolContext['emit']> = [];
  const finalStep = tools.length > 0 ? 1 : 0;
  const emitsData =
    scenario.tools === 'tool emits data before result' || scenario.tools === 'tool emits data after result';
  const emitsLate = scenario.tools === 'tool emits data after result';
  const handlerNames = tools.filter((tool) => tool.kind !== 'unsupported').map((tool) => tool.name);

  const callLateEmits = (where: string): void => {
    for (const emit of capturedEmits) emit('late', { where, marker: DATA_MARKER });
  };

  const additionalTools: Chat.AdditionalTool[] = [LOOKUP.name, STOCK.name].map((name) => ({
    definition: toolDefinition(name),
    handler: async (_args, context) => {
      const plan = tools.find((tool) => tool.name === name);
      const index = handlersRun.length;
      handlersRun.push(name);
      if (emitsData) context?.emit('progress', { percent: 50, marker: DATA_MARKER });
      // A tool that runs after another one calls the earlier tool's emit, which has finished
      if (emitsLate) callLateEmits('next tool');
      if (emitsLate && context) capturedEmits.push(context.emit);

      const isLast = index === handlerNames.length - 1;
      if (scenario.outcome === 'abort between tools' && index === 0) controller.abort();
      if (scenario.outcome === 'abort after last tool' && isLast) controller.abort();
      if (scenario.outcome === 'abort while a tool runs' && index === 0) {
        // A tool that honours its signal: it waits, and rejects with the abort reason
        setTimeout(() => controller.abort(), 0);
        await new Promise<never>((_, reject) =>
          context?.signal?.addEventListener('abort', () => reject(context.signal?.reason), { once: true })
        );
      }
      if (plan?.kind === 'throws') throw new Error('tool failed with a private reason');
      return textResult(`${name} done`);
    }
  }));

  const toolCallsOfTurn = tools.map(({ name, callId, args }) => ({ name, callId, arguments: args }));
  const toolTurn = (): ScriptedTurn => {
    switch (scenario.outcome) {
      case 'provider error in the tool step':
        return { error: providerError };
      case 'abort during the tool step':
        if (scenario.policy === 'all') {
          return {
            toolCalls: toolCallsOfTurn,
            text: TOOL_STEP_TEXT,
            chunks: TOOL_STEP_CHUNKS,
            chunkDelayMs: 1,
            waitForAbortAfterChunks: true
          };
        }
        setTimeout(() => controller.abort(), 0);
        return streams
          ? {
              toolCalls: toolCallsOfTurn,
              text: TOOL_STEP_TEXT,
              chunks: TOOL_STEP_CHUNKS,
              waitForAbortAfterChunks: true
            }
          : { waitForAbort: true };
      default:
        return { toolCalls: toolCallsOfTurn, text: TOOL_STEP_TEXT, chunks: TOOL_STEP_CHUNKS };
    }
  };

  const finalTurn = (): ScriptedTurn => {
    switch (scenario.outcome) {
      case 'provider error before deltas':
        return { error: providerError };
      case 'provider error after deltas':
        return { text: FINAL_TEXT, chunks: FINAL_CHUNKS, failAfterChunks: providerError };
      case 'abort during deltas':
        if (scenario.policy === 'all') {
          // Aborted from onEvent on the first delta, between chunks
          return { text: FINAL_TEXT, chunks: FINAL_CHUNKS, chunkDelayMs: 1, waitForAbortAfterChunks: true };
        }
        setTimeout(() => controller.abort(), 0);
        return streams
          ? { text: FINAL_TEXT, chunks: FINAL_CHUNKS, waitForAbortAfterChunks: true }
          : { waitForAbort: true };
      default:
        return { text: FINAL_TEXT, chunks: FINAL_CHUNKS };
    }
  };
  const finalReply: ScriptedReply = () => {
    if (emitsLate) callLateEmits('next LLM call');
    return finalTurn();
  };

  const replies: ScriptedReply[] = tools.length > 0 ? [toolTurn, finalReply] : [finalReply];
  // The scripted model rejects a call after its last reply; an error or abort in the tool step needs no final reply
  if (scenario.outcome === 'provider error in the tool step' || scenario.outcome === 'abort during the tool step') {
    replies.pop();
  }
  const { chat, llm, chatHistoryManager } = await createChat(replies);
  const strategyGenerate = vi.spyOn(llm, 'generate');

  const events: ChatEvent[] = [];
  const onEvent = (event: ChatEvent): void => {
    events.push(event);
    const abortOnDeltaOf =
      scenario.outcome === 'abort during deltas'
        ? finalStep
        : scenario.outcome === 'abort during the tool step'
          ? 0
          : -1;
    if (scenario.policy === 'all' && event.type === 'text-delta' && event.step === abortOnDeltaOf) controller.abort();
    // After the last LLM call returned, before the middleware and finish
    if (scenario.outcome === 'abort after the last step' && event.type === 'step-finish' && event.step === finalStep) {
      controller.abort();
    }
  };

  if (scenario.outcome === 'abort before start') controller.abort();

  const run: Run = {
    events,
    providerError,
    handlersRun,
    eventsAfterSettle: 0,
    providerSinks: [],
    chatHistoryManager,
    llmCalls: 0
  };
  try {
    run.result = await chat.generate({
      sessionId: SESSION_ID,
      directMessages: [userMessage('Where is my order?')],
      additionalTools,
      signal: controller.signal,
      onEvent,
      streamOptions: streamOptionsOf(scenario)
    });
    await run.result.messages.save();
  } catch (error) {
    run.failure = error;
  }

  // Emits after the run ended do nothing, and no stray timer sends anything later
  const settledAt = events.length;
  callLateEmits('after the run');
  await new Promise((resolve) => setTimeout(resolve, 5));
  run.eventsAfterSettle = events.length - settledAt;
  run.providerSinks = strategyGenerate.mock.calls.map(([, options]) => options?.onEvent !== undefined);
  run.llmCalls = llm.calls.length;
  return run;
}

// ---- The invariants ----

const upper = (text: string): string => text.toUpperCase();

function textOfMessage(message: Type.Entity.CreateMessage | undefined): string {
  return (message?.content ?? []).map((part) => (part.type === 'text' ? part.text : '')).join('');
}

// An abort after the last LLM call returned is not checked again: generate() resolves as without events
const resolves = (outcome: Outcome): boolean => outcome === 'success' || outcome === 'abort after the last step';

function expectedTerminal(outcome: Outcome): ChatEvent['type'] | undefined {
  if (resolves(outcome)) return 'finish';
  switch (outcome) {
    case 'provider error before deltas':
    case 'provider error after deltas':
    case 'provider error in the tool step':
      return 'error';
    case 'abort before start':
      return undefined;
    default:
      return 'abort';
  }
}

// Whether the LLM call that asks for the tools returned, so its tools ran
function toolStepCompleted(scenario: Scenario): boolean {
  return (
    scenario.tools !== 'no tools' &&
    scenario.outcome !== 'provider error in the tool step' &&
    scenario.outcome !== 'abort during the tool step'
  );
}

function checkOutcome(scenario: Scenario, run: Run): void {
  if (resolves(scenario.outcome)) {
    expect(run.failure, 'generate resolves').toBeUndefined();
    return;
  }
  expect(run.result, 'generate rejects').toBeUndefined();
  expect(run.chatHistoryManager.addMessages, 'nothing is saved').not.toHaveBeenCalled();
  if (scenario.outcome === 'abort before start') {
    expect(run.events, 'an abort before start emits nothing').toEqual([]);
    return;
  }
  expect(run.failure).toBeInstanceOf(GenerateError);
  if (expectedTerminal(scenario.outcome) === 'error') {
    expect(run.failure, 'the provider error is the cause').toMatchObject({ cause: run.providerError });
  } else {
    expect(run.failure, 'an abort is the cause').toMatchObject({ cause: { name: 'AbortError' } });
  }
}

function checkEnvelope(scenario: Scenario, run: Run): void {
  const { events } = run;
  expect(
    events.map((event) => event.seq),
    'seq counts from 0 without gaps'
  ).toEqual(events.map((_, index) => index));
  expect(new Set(events.map((event) => event.runId)).size, 'one runId per call').toBe(1);

  const start = events[0];
  expect(start?.type, 'start comes first').toBe('start');
  expect(ofType(events, 'start'), 'one start').toHaveLength(1);
  expect(start).toMatchObject({
    sessionId: SESSION_ID,
    textPolicy: scenario.policy === 'after-middleware' ? 'after-middleware' : 'all',
    streaming: providerStreams(scenario)
  });

  const terminals = events.filter((event) => TERMINAL_TYPES.includes(event.type));
  expect(terminals, 'exactly one terminal event').toHaveLength(1);
  expect(events.at(-1)?.type, 'the terminal event is last').toBe(expectedTerminal(scenario.outcome));
  expect(run.eventsAfterSettle, 'nothing after the terminal event').toBe(0);

  expect(
    run.providerSinks.every((hasSink) => hasSink === providerStreams(scenario)),
    'providers get a sink exactly when the call streams'
  ).toBe(true);
}

interface StepView {
  step: number;
  events: ChatEvent[];
  finished: boolean;
}

// Checks the step framing and returns the events of each step
function checkSteps(run: Run): StepView[] {
  const body = run.events.slice(1, -1);
  const steps: StepView[] = [];
  let current: StepView | undefined;
  for (const event of body) {
    if (event.type === 'step-start') {
      expect(current?.finished ?? true, 'a step starts only after the previous one finished').toBe(true);
      expect(event.step, 'steps are numbered from 0 without gaps').toBe(steps.length);
      current = { step: event.step, events: [event], finished: false };
      steps.push(current);
      continue;
    }
    expect(current && !current.finished, `${event.type} comes inside an open step`).toBe(true);
    if (!current) return steps;
    expect('step' in event ? event.step : undefined, `${event.type} carries its step's number`).toBe(current.step);
    current.events.push(event);
    if (event.type === 'step-finish') current.finished = true;
  }

  const terminal = run.events.at(-1);
  if (terminal?.type === 'finish') {
    expect(
      steps.every((step) => step.finished),
      'every step is finished before finish'
    ).toBe(true);
  }

  for (const { events } of steps) {
    const types = events.map((event) => (event.type === 'status' ? `status:${event.phase}` : event.type));
    expect(types.slice(0, 2), 'a step opens with step-start and status queued').toEqual([
      'step-start',
      'status:queued'
    ]);
    const generating = types.indexOf('status:generating');
    expect(
      types.filter((type) => type === 'status:generating'),
      'status generating once per step'
    ).toHaveLength(generating === -1 ? 0 : 1);
    const firstContent = types.findIndex((type, index) => index >= 2 && type !== 'status:generating');
    if (firstContent !== -1) {
      expect(generating, 'status generating comes before the first output of a step').toBeGreaterThan(1);
      expect(generating).toBeLessThan(firstContent);
    }
    // Text comes before the tool events of the step
    const lastText = types.lastIndexOf('text-delta');
    const firstTool = types.findIndex((type) => type === 'tool-call' || type === 'tool-result' || type === 'data');
    if (lastText !== -1 && firstTool !== -1) expect(lastText, 'text before tools').toBeLessThan(firstTool);
  }
  return steps;
}

function checkText(scenario: Scenario, run: Run, steps: StepView[]): void {
  const { events } = run;
  expect(ofType(events, 'reasoning-delta'), 'the scripted model sends no reasoning').toEqual([]);
  const llmSteps = steps.filter((step) => step.step < run.llmCalls);
  const deltasOf = (step: StepView): string[] => ofType(step.events, 'text-delta').map((event) => event.delta);
  const expectedChunks = (step: number): string[] =>
    step === 0 && scenario.tools !== 'no tools' ? TOOL_STEP_CHUNKS : FINAL_CHUNKS;

  for (const step of llmSteps) {
    const deltas = deltasOf(step);
    const stepFinish = ofType(step.events, 'step-finish')[0];
    if (scenario.policy === 'after-middleware') {
      expect(deltas, 'no text during steps under after-middleware').toEqual([]);
      if (stepFinish) expect(stepFinish.streamed).toBe(false);
    } else if (scenario.policy === 'observe-only') {
      expect(deltas.length, 'observe-only sends the text at most once per step').toBeLessThanOrEqual(1);
      if (stepFinish) {
        expect(stepFinish.streamed).toBe(false);
        expect(deltas, 'observe-only sends the step text once').toEqual([expectedChunks(step.step).join('')]);
      }
    } else if (stepFinish) {
      expect(deltas, 'policy all streams the chunks as they arrive').toEqual(expectedChunks(step.step));
      expect(stepFinish.streamed).toBe(true);
    }
  }

  const extraSteps = steps.filter((step) => step.step >= run.llmCalls);
  const finish = ofType(events, 'finish')[0];
  if (!finish) {
    expect(extraSteps, 'no text step without finish').toEqual([]);
    return;
  }

  // finish.text is the final text, as returned and saved
  expect(finish.text).toBe(upper(FINAL_TEXT));
  expect(finish.finishReason).toBe('stop');
  expect(textOfMessage(run.result?.messages.llmResponse.topChoice), 'finish.text is the returned text').toBe(
    finish.text
  );
  const savedAssistant = run.chatHistoryManager.saved.filter(
    (message) => message.role === Type.LLM.UnifiedMessageRole.assistant
  );
  expect(textOfMessage(savedAssistant.at(-1)), 'finish.text is the saved text').toBe(finish.text);

  if (scenario.policy === 'after-middleware') {
    expect(extraSteps, 'after-middleware sends the final text in one step of its own').toHaveLength(1);
    expect(deltasOf(extraSteps[0])).toEqual([finish.text]);
    expect(finish.textReplaced).toBe(false);
  } else {
    expect(extraSteps, 'no extra text step').toEqual([]);
    const lastStepText = deltasOf(steps.at(-1) ?? { step: -1, events: [], finished: true }).join('');
    expect(finish.textReplaced, 'textReplaced says whether finish.text differs from the last step text').toBe(
      finish.text !== lastStepText
    );
  }

  // Usage is the sum over the provider calls
  const stepUsages = ofType(events, 'step-finish').flatMap((event) => (event.usage ? [event.usage] : []));
  expect(stepUsages).toHaveLength(run.llmCalls);
  expect(finish.usage.totalTokens).toBe(stepUsages.reduce((sum, usage) => sum + usage.totalTokens, 0));
}

function checkTools(scenario: Scenario, run: Run, steps: StepView[]): void {
  const { events } = run;
  const tools = plannedTools(scenario.tools);
  const serialised = JSON.stringify(events);
  expect(serialised, 'the made-up tool name never reaches the caller').not.toContain(MADE_UP.name);
  expect(serialised, 'the made-up arguments never reach the caller').not.toContain('model-invented-value');
  expect(serialised, 'tool errors never reach the caller').not.toContain('private');
  expect(JSON.stringify(run.chatHistoryManager.saved), 'data is never saved').not.toContain(DATA_MARKER);

  const toolCalls = ofType(events, 'tool-call');
  const toolResults = ofType(events, 'tool-result');
  const data = ofType(events, 'data');

  for (const step of steps) {
    const stepFinish = ofType(step.events, 'step-finish')[0];
    if (stepFinish && step.step < run.llmCalls) {
      const hadTools = step.step === 0 && tools.length > 0;
      expect(stepFinish.hadToolCalls, `step ${step.step} hadToolCalls`).toBe(hadTools);
    }
  }

  expect(
    data.filter((event) => event.name === 'late'),
    'emit after the tool result is a no-op'
  ).toEqual([]);
  const expectedProgress = scenario.tools.startsWith('tool emits data') ? run.handlersRun.length : 0;
  expect(data.filter((event) => event.name === 'progress')).toHaveLength(expectedProgress);
  for (const event of data) {
    const tool = tools.find((planned) => planned.callId === event.toolCallId);
    expect(event.toolName).toBe(tool?.name);
    expect(event.step).toBe(0);
  }

  if (scenario.toolCalls === 'none') {
    expect(toolCalls, "toolCalls 'none' sends no tool-call").toEqual([]);
    expect(toolResults, "toolCalls 'none' sends no tool-result").toEqual([]);
    return;
  }

  // Every tool that started reports a result; unsupported calls first, then the tools in execution order
  const unsupported = tools.filter((tool) => tool.kind === 'unsupported');
  const ran = tools.filter((tool) => tool.kind !== 'unsupported' && run.handlersRun.includes(tool.name));
  const expectedOrder = toolStepCompleted(scenario) ? [...unsupported, ...ran] : [];
  expect(toolCalls.map((event) => event.toolCallId)).toEqual(expectedOrder.map((tool) => tool.callId));
  expect(toolResults.map((event) => event.toolCallId)).toEqual(toolCalls.map((event) => event.toolCallId));
  // The first tool that ran fails when it was aborted while running
  const abortedCallId = scenario.outcome === 'abort while a tool runs' ? ran[0]?.callId : undefined;

  for (const call of toolCalls) {
    const planned = tools.find((tool) => tool.callId === call.toolCallId);
    expect(planned, 'a tool-call names a planned call').toBeDefined();
    if (!planned) continue;
    const isUnsupported = planned.kind === 'unsupported';
    expect(call.name, 'an unsupported tool is reported as unknown').toBe(isUnsupported ? 'unknown' : planned.name);
    if (scenario.toolCalls === 'names') {
      expect('args' in call, "toolCalls 'names' sends no arguments").toBe(false);
    } else if (isUnsupported) {
      expect(call.args ?? {}, 'an unsupported call carries no arguments').toEqual({});
    } else {
      expect(call.args, "toolCalls 'args' sends the parsed arguments").toEqual(planned.args);
    }

    const result = toolResults.find((event) => event.toolCallId === call.toolCallId);
    expect(result?.name).toBe(call.name);
    expect(result?.status, 'tool-result failed exactly when the tool failed').toBe(
      planned.kind === 'succeeds' && planned.callId !== abortedCallId ? 'succeeded' : 'failed'
    );
    expect(result?.step).toBe(call.step);

    // data only between its tool-call and tool-result
    const callIndex = events.indexOf(call);
    const resultIndex = result ? events.indexOf(result) : -1;
    for (const event of data.filter((item) => item.toolCallId === call.toolCallId)) {
      const index = events.indexOf(event);
      expect(index, 'data comes after its tool-call').toBeGreaterThan(callIndex);
      expect(index, 'data comes before its tool-result').toBeLessThan(resultIndex);
    }
  }
}

function checkInvariants(scenario: Scenario, run: Run): void {
  checkOutcome(scenario, run);
  if (scenario.outcome === 'abort before start') return;
  checkEnvelope(scenario, run);
  const steps = checkSteps(run);
  checkText(scenario, run, steps);
  checkTools(scenario, run, steps);
}

// ---- The tests ----

const matrix = buildMatrix();

describe('generation events over the scenario matrix', () => {
  it('the matrix covers every applicable combination', () => {
    expect(matrix.length).toBeGreaterThan(600);
    expect(new Set(matrix.map((scenario) => scenario.name)).size).toBe(matrix.length);
  });

  describe.each(POLICIES)('text policy %s', (policy) => {
    const scenarios = matrix.filter((scenario) => scenario.policy === policy);
    const passing = scenarios.filter((scenario) => !KNOWN_FAILURES.has(scenario.name));
    const failing = scenarios.filter((scenario) => KNOWN_FAILURES.has(scenario.name));

    it.each(passing.map((scenario) => [scenario.name, scenario] as const))('%s', async (_name, scenario) => {
      checkInvariants(scenario, await runScenario(scenario));
    });

    if (failing.length > 0) {
      it.fails.each(failing.map((scenario) => [scenario.name, scenario] as const))(
        'finding: %s',
        async (_name, scenario) => {
          checkInvariants(scenario, await runScenario(scenario));
        }
      );
    }
  });
});

describe('generation events beyond the matrix', () => {
  const progressTool = (name: string): Chat.AdditionalTool => ({
    definition: toolDefinition(name),
    handler: async (_args, context) => {
      context?.emit('progress', { percent: 50 });
      return textResult(`${name} done`);
    }
  });

  async function generate(
    replies: ScriptedReply[],
    options: { streamOptions?: Chat.StreamOptions; tools?: Chat.AdditionalTool[]; maxCallsPerGenerate?: number } = {}
  ) {
    const { chat, chatHistoryManager } = await createChat(replies, options.maxCallsPerGenerate);
    const events: ChatEvent[] = [];
    const result = await chat.generate({
      sessionId: SESSION_ID,
      directMessages: [userMessage('Where is my order?')],
      additionalTools: options.tools,
      onEvent: (event) => events.push(event),
      streamOptions: options.streamOptions
    });
    return { result, events, chatHistoryManager };
  }

  // A finished tool call is known by its step and id, so a later step may reuse the id
  it('a tool call id reused in a later step still gets its data events', async () => {
    // Some OpenAI-compatible servers number tool calls per response, so ids repeat across steps
    const { events } = await generate(
      [
        { toolCalls: [{ name: LOOKUP.name, callId: 'call-0', arguments: { id: '1' } }] },
        { toolCalls: [{ name: LOOKUP.name, callId: 'call-0', arguments: { id: '2' } }] },
        { text: FINAL_TEXT }
      ],
      { streamOptions: { textPolicy: 'all' }, tools: [progressTool(LOOKUP.name)] }
    );

    expect(ofType(events, 'tool-result').map((event) => event.step)).toEqual([0, 1]);
    expect(ofType(events, 'data').map((event) => event.step)).toEqual([0, 1]);
  });

  it.each(POLICIES)('a throwing onEvent does not change the result under %s', async (policy) => {
    const { chat, chatHistoryManager } = await createChat([
      { toolCalls: [{ name: LOOKUP.name, callId: LOOKUP.callId, arguments: LOOKUP.args }] },
      { text: FINAL_TEXT, chunks: FINAL_CHUNKS }
    ]);
    let calls = 0;

    const result = await chat.generate({
      sessionId: SESSION_ID,
      directMessages: [userMessage('Where is my order?')],
      additionalTools: [progressTool(LOOKUP.name)],
      onEvent: () => {
        calls += 1;
        throw new Error('the consumer broke');
      },
      streamOptions: streamOptionsOf({ policy, reasoning: false, toolCalls: 'args' })
    });
    await result.messages.save();

    expect(calls).toBeGreaterThan(5);
    expect(result.status).toBe(Chat.Status.SUCCESS);
    expect(textOfMessage(result.messages.llmResponse.topChoice)).toBe(upper(FINAL_TEXT));
    expect(textOfMessage(chatHistoryManager.saved.at(-1))).toBe(upper(FINAL_TEXT));
  });

  it.each(POLICIES)('the tool-loop limit ends with one empty finish under %s', async (policy) => {
    const toolTurn: ScriptedTurn = {
      toolCalls: [{ name: LOOKUP.name, arguments: LOOKUP.args }],
      text: TOOL_STEP_TEXT,
      chunks: TOOL_STEP_CHUNKS
    };
    const { events } = await generate([toolTurn, toolTurn], {
      streamOptions: streamOptionsOf({ policy, reasoning: false, toolCalls: 'names' }),
      tools: [progressTool(LOOKUP.name)],
      maxCallsPerGenerate: 2
    });

    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
    expect(events.filter((event) => TERMINAL_TYPES.includes(event.type))).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'finish', finishReason: 'max_loops_exceeded', text: '' });
    // No text step for the empty final text, and LOFT's limit message never reaches the caller
    expect(ofType(events, 'step-start').map((event) => event.step)).toEqual([0, 1]);
    expect(JSON.stringify(events)).not.toContain('limit reached');
    if (policy === 'after-middleware') expect(ofType(events, 'text-delta')).toEqual([]);
  });

  it('data still arrives inside its step when tool calls are not reported', async () => {
    const { events } = await generate(
      [{ toolCalls: [{ name: LOOKUP.name, callId: LOOKUP.callId, arguments: LOOKUP.args }] }, { text: FINAL_TEXT }],
      { streamOptions: { textPolicy: 'all', include: { toolCalls: 'none' } }, tools: [progressTool(LOOKUP.name)] }
    );

    expect(ofType(events, 'tool-call')).toEqual([]);
    expect(ofType(events, 'tool-result')).toEqual([]);
    expect(ofType(events, 'data')).toEqual([
      expect.objectContaining({ step: 0, toolCallId: LOOKUP.callId, toolName: LOOKUP.name, name: 'progress' })
    ]);
  });
});
