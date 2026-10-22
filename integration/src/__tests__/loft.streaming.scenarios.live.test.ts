import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import {
  AnthropicCallStrategy,
  AnthropicLoftStrategy,
  AnthropicRequest,
  AnthropicResponse
} from '@moc-global/loft-anthropic-strategy';
import {
  Chat,
  ContextInterface,
  GenerateError,
  NativeCallManagerStrategy,
  StandardMiddleware,
  Type
} from '@moc-global/loft-definitions';
import {
  GeminiCallStrategy,
  GeminiLoftStrategy,
  GeminiRequest,
  GeminiResponse
} from '@moc-global/loft-gemini-strategy';
import {
  GenerateCallManager,
  GenerateConfig,
  LlmTokenizer,
  LlmTokenRateLimiter
} from '@moc-global/loft-llm-call-manager';
import {
  OpenAiCallStrategy,
  OpenAiLoftStrategy,
  OpenAiRequest,
  OpenAiResponse
} from '@moc-global/loft-openai-strategy';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { env, hasKeys, requireKey } from './config';
import { initDB, type TestDatabaseInstance } from './initDB';
import { createChatConstructor, createLoftConstructor } from './loftInit';

type StreamEvent = Chat.ChatStreamEvent;
type ChatConstructorType = ReturnType<typeof createChatConstructor>;
type LoftConstructorType = ReturnType<typeof createLoftConstructor>;
type CallManagerExtras = Pick<GenerateConfig, 'streamIdleTimeoutMs'>;

// The rate limits and retries of the shared live helpers, with room for the call manager's streaming settings
function limiter() {
  return new LlmTokenRateLimiter({
    newTokensPerSecond: env.LOFT_OPENAI_CALL_STRATEGY_NEW_TOKENS_PER_SECOND,
    newRequestsPerSecond: env.LOFT_OPENAI_CALL_STRATEGY_NEW_REQUESTS_PER_SECOND,
    maxRequests: env.LOFT_OPENAI_CALL_STRATEGY_MAX_REQUESTS,
    maxTokens: env.LOFT_OPENAI_CALL_STRATEGY_MAX_TOKENS,
    maxAwaitSeconds: env.LOFT_OPENAI_CALL_STRATEGY_MAX_AWAIT_SECONDS
  });
}

function generateConfig(extras: CallManagerExtras): GenerateConfig {
  return {
    highPriorityTasksLimit: env.LOFT_OPENAI_CALL_MANAGER_HIGH_PRIORITY_TASKS_LIMIT,
    retryDelay: env.LOFT_OPENAI_CALL_MANAGER_RETRY_DELAY,
    retryAttemptsLimit: env.LOFT_OPENAI_CALL_MANAGER_RETRY_ATTEMPTS_LIMIT,
    ...extras
  };
}

interface ProviderCase {
  label: string;
  key: 'LOFT_OPENAI_API_KEY' | 'LOFT_ANTHROPIC_API_KEY' | 'LOFT_GEMINI_VERTEX_PROJECT';
  llmName: string;
  /** A model entry with a JSON schema for its reply, when the strategy can send one */
  structuredLlmName?: string;
  /** Whether the strategy streams the request with the JSON schema */
  structuredStreams: boolean;
  /** How the strategy's abort error is recognised on GenerateError.cause */
  abortCause: { constructorName?: string; name?: string };
  register(loftConstructor: LoftConstructorType, llmName: string, extras: CallManagerExtras): Promise<void>;
}

const PROVIDERS: ProviderCase[] = [
  {
    label: 'OpenAI',
    key: 'LOFT_OPENAI_API_KEY',
    llmName: 'scenario-gpt-4o-mini',
    structuredLlmName: 'gpt-4o-mini-streaming-json-schema',
    structuredStreams: false,
    abortCause: { constructorName: 'APIUserAbortError' },
    register: (loftConstructor, llmName, extras) =>
      loftConstructor.registerLlmStrategy(
        llmName,
        new OpenAiLoftStrategy(
          { llmName },
          new NativeCallManagerStrategy(
            new GenerateCallManager<OpenAiRequest, OpenAiResponse>(
              llmName,
              generateConfig(extras),
              new OpenAiCallStrategy(requireKey('LOFT_OPENAI_API_KEY'), limiter(), new LlmTokenizer())
            )
          )
        )
      )
  },
  {
    label: 'Anthropic',
    key: 'LOFT_ANTHROPIC_API_KEY',
    llmName: 'scenario-claude-haiku',
    structuredLlmName: 'scenario-claude-haiku-json-schema',
    structuredStreams: true,
    abortCause: { constructorName: 'APIUserAbortError' },
    register: (loftConstructor, llmName, extras) =>
      loftConstructor.registerLlmStrategy(
        llmName,
        new AnthropicLoftStrategy(
          { llmName },
          new NativeCallManagerStrategy(
            new GenerateCallManager<AnthropicRequest, AnthropicResponse>(
              llmName,
              generateConfig(extras),
              new AnthropicCallStrategy({ apiKey: requireKey('LOFT_ANTHROPIC_API_KEY') }, limiter(), new LlmTokenizer())
            )
          )
        )
      )
  },
  {
    label: 'Gemini',
    key: 'LOFT_GEMINI_VERTEX_PROJECT',
    llmName: 'scenario-gemini-flash-lite',
    // The Gemini strategy does not pass a response schema from the model preset to the request
    structuredLlmName: undefined,
    structuredStreams: true,
    abortCause: { name: 'AbortError' },
    register: (loftConstructor, llmName, extras) =>
      loftConstructor.registerLlmStrategy(
        llmName,
        new GeminiLoftStrategy(
          { llmName },
          new NativeCallManagerStrategy(
            new GenerateCallManager<GeminiRequest, GeminiResponse>(
              llmName,
              generateConfig(extras),
              new GeminiCallStrategy(
                {
                  mode: 'vertexai',
                  project: requireKey('LOFT_GEMINI_VERTEX_PROJECT'),
                  location: env.LOFT_GEMINI_VERTEX_LOCATION
                },
                limiter(),
                new LlmTokenizer()
              )
            )
          )
        )
      )
  }
];

const userMessage = (text: string, sessionId: string, llmName: string): Type.Entity.CreateMessage => ({
  id: randomUUID(),
  sessionId,
  ctx: {},
  llmName,
  manifestName: 'test-bot',
  content: [{ type: 'text', text }],
  role: Type.LLM.UnifiedMessageRole.user,
  author: 'user',
  llmIgnore: false
});

const textOf = (message: Pick<Type.Entity.Message, 'content'> | undefined) =>
  (message?.content ?? []).map((part) => (part.type === 'text' ? part.text : '')).join('');

function ofType<T extends StreamEvent['type']>(events: StreamEvent[], type: T) {
  return events.filter((event): event is Extract<StreamEvent, { type: T }> => event.type === type);
}

const TERMINAL = new Set(['finish', 'error', 'abort']);

// Every call numbers its events 0, 1, 2… and ends with exactly one terminal event
function expectWellFormed(events: StreamEvent[]) {
  expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
  expect(events.filter((event) => TERMINAL.has(event.type))).toHaveLength(1);
  expect(TERMINAL.has(events.at(-1)?.type ?? '')).toBe(true);
  expect(events[0]?.type).toBe('start');
  expect(new Set(events.map((event) => event.runId)).size).toBe(1);
}

// Steps are numbered from 0, never interleave, and keep their order: step-start, the queued and generating statuses,
// the text, then each tool's call, data and result, then step-finish. Only an abort or an error may cut a step short.
function expectStepOrder(events: StreamEvent[]) {
  let current: number | undefined;
  const started: number[] = [];
  const inStep: StreamEvent[] = [];

  const checkStep = (stepEvents: StreamEvent[]) => {
    const types = stepEvents.map((event) => (event.type === 'status' ? `status:${event.phase}` : event.type));
    const queued = types.indexOf('status:queued');
    const generating = types.indexOf('status:generating');
    const firstText = types.findIndex((type) => type === 'text-delta' || type === 'reasoning-delta');
    const lastText = types.reduce(
      (last, type, index) => (type === 'text-delta' || type === 'reasoning-delta' ? index : last),
      -1
    );
    const firstTool = types.findIndex((type) => type === 'tool-call' || type === 'data' || type === 'tool-result');
    if (queued >= 0 && generating >= 0) expect(queued).toBeLessThan(generating);
    if (generating >= 0 && firstText >= 0) expect(generating).toBeLessThan(firstText);
    if (firstTool >= 0 && lastText >= 0) expect(lastText).toBeLessThan(firstTool);
    // A tool's data comes after its call and before its result
    for (const data of ofType(stepEvents, 'data')) {
      const call = ofType(stepEvents, 'tool-call').find((event) => event.toolCallId === data.toolCallId);
      const result = ofType(stepEvents, 'tool-result').find((event) => event.toolCallId === data.toolCallId);
      if (call) expect(call.seq).toBeLessThan(data.seq);
      expect(result).toBeDefined();
      expect(data.seq).toBeLessThan(result?.seq ?? -1);
    }
  };

  for (const event of events) {
    if (!('step' in event)) {
      if (current !== undefined) {
        // A step left open is only allowed when the run was aborted or failed
        expect(['abort', 'error']).toContain(event.type);
        checkStep(inStep);
      }
      continue;
    }
    if (event.type === 'step-start') {
      expect(current).toBeUndefined();
      current = event.step;
      started.push(event.step);
      inStep.length = 0;
      continue;
    }
    expect(event.step).toBe(current);
    inStep.push(event);
    if (event.type === 'step-finish') {
      checkStep(inStep);
      current = undefined;
    }
  }
  expect(started).toEqual(started.map((_, index) => index));
}

/** The event types of a run, with repeats folded, for the report. No text, arguments or data. */
function sequenceOf(events: StreamEvent[]): string {
  const labels = events.map((event) => {
    switch (event.type) {
      case 'start':
        return `start(${event.textPolicy},${event.streaming ? 'streaming' : 'not-streaming'})`;
      case 'status':
        return `status:${event.phase}#${event.step}`;
      case 'step-start':
        return `step-start#${event.step}`;
      case 'text-delta':
        return `text-delta#${event.step}`;
      case 'reasoning-delta':
        return `reasoning-delta#${event.step}`;
      case 'tool-call':
        return `tool-call(${event.name})#${event.step}`;
      case 'data':
        return `data(${event.toolName})#${event.step}`;
      case 'tool-result':
        return `tool-result(${event.name},${event.status})#${event.step}`;
      case 'step-finish':
        return `step-finish(${event.finishReason},${event.streamed ? 'streamed' : 'not-streamed'})#${event.step}`;
      case 'finish':
        return `finish(${event.finishReason}${event.textReplaced ? ',replaced' : ''})`;
      case 'error':
        return `error(${event.code})`;
      default:
        return event.type;
    }
  });
  const folded: string[] = [];
  let index = 0;
  while (index < labels.length) {
    let end = index;
    while (end + 1 < labels.length && labels[end + 1] === labels[index]) end += 1;
    const count = end - index + 1;
    folded.push(count > 1 ? `${labels[index]}x${count}` : labels[index]);
    index = end + 1;
  }
  return folded.join(' ');
}

function report(provider: ProviderCase, scenario: string, events: StreamEvent[], extra = '') {
  console.info(`[scenario] ${provider.label} | ${scenario} | ${sequenceOf(events)}${extra ? ` | ${extra}` : ''}`);
}

// An AfterGenerate middleware that changes the reply text
const shout: StandardMiddleware<ContextInterface, Chat.GenerateResultMessages> = async (_ctx, payload, chain) => {
  payload.llmResponse.topChoice.content = payload.llmResponse.topChoice.content.map((part) =>
    part.type === 'text' ? { ...part, text: part.text.toUpperCase() } : part
  );
  chain.next();
  return payload;
};

// Two additional tools for one parallel round: the weather tool reports progress through context.emit
const weatherTool: Chat.AdditionalTool = {
  definition: {
    name: 'get_weather',
    description: 'Returns the current weather in a city',
    inputSchema: {
      type: Chat.AdditionalToolSchemaType.OBJECT,
      properties: { city: { type: 'string', description: 'The city name' } },
      required: ['city']
    }
  },
  async handler(args, context) {
    context?.emit('progress', { stage: 'looking up' });
    return {
      content: [{ type: Chat.AdditionalToolContentType.TEXT, text: `${String(args.city)}: 18 degrees, light rain` }]
    };
  }
};

const localTimeTool: Chat.AdditionalTool = {
  definition: {
    name: 'get_local_time',
    description: 'Returns the current local time in a city',
    inputSchema: {
      type: Chat.AdditionalToolSchemaType.OBJECT,
      properties: { city: { type: 'string', description: 'The city name' } },
      required: ['city']
    }
  },
  async handler(args) {
    return { content: [{ type: Chat.AdditionalToolContentType.TEXT, text: `${String(args.city)}: 14:05` }] };
  }
};

for (const provider of PROVIDERS) {
  // Live: needs the provider's key (Gemini: the Vertex project and Application Default Credentials for it)
  describe.runIf(hasKeys(provider.key))(`Loft streaming scenarios with ${provider.label} (live)`, () => {
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
      options: {
        llmName?: string;
        extras?: CallManagerExtras;
        configure?: (chatConstructor: ChatConstructorType) => void;
      } = {}
    ) {
      const llmName = options.llmName ?? provider.llmName;
      const chatConstructor = createChatConstructor(testDb);
      const loftConstructor = createLoftConstructor(chatConstructor);
      await provider.register(loftConstructor, llmName, options.extras ?? {});
      options.configure?.(chatConstructor);
      const loft = loftConstructor.getInstance();

      const newSession = () =>
        loft.chat.createSession({ currentLlmName: llmName, currentManifestName: 'test-bot', ctx: {} });
      const session = await newSession();

      const ask = (
        text: string,
        generateOptions: Omit<Chat.GenerateOptions, 'sessionId' | 'directMessages'> = {},
        sessionId = session.id
      ) =>
        loft.chat.generate({
          sessionId,
          directMessages: [userMessage(text, sessionId, llmName)],
          ...generateOptions
        });
      const history = async (sessionId = session.id) => [...(await loft.chat.getChatHistory(sessionId))];
      const savedReply = async (sessionId = session.id) =>
        (await history(sessionId)).filter((message) => message.role === Type.LLM.UnifiedMessageRole.assistant).at(-1);
      return { loft, session, newSession, ask, history, savedReply };
    }

    it('three-turn conversation streams every turn, saves it, and the third turn sees the first', async () => {
      const { ask, history, savedReply } = await setup();
      const turns = [
        'My name is Olena and my favourite colour is teal. Do not use any tool. Reply in one short sentence.',
        'Name one thing that is often that colour. Do not use any tool. Reply in one short sentence.',
        'What is my name? Do not use any tool. Answer with the name only.'
      ];

      const finishes: Extract<StreamEvent, { type: 'finish' }>[] = [];
      for (const [index, turn] of turns.entries()) {
        const events: StreamEvent[] = [];
        const result = await ask(turn, { onEvent: (event) => events.push(event) });
        await result.messages.save();
        report(provider, `multi-turn ${index + 1}`, events);

        expectWellFormed(events);
        expectStepOrder(events);
        expect(events[0]).toMatchObject({ type: 'start', textPolicy: 'all', streaming: true });
        const deltas = ofType(events, 'text-delta');
        expect(deltas.length).toBeGreaterThan(0);
        const [finish] = ofType(events, 'finish');
        expect(finish.text).toBe(deltas.map((event) => event.delta).join(''));
        expect(finish.textReplaced).toBe(false);
        expect(ofType(events, 'step-finish').map((event) => event.streamed)).toEqual([true]);
        expect(textOf(await savedReply())).toBe(finish.text);
        finishes.push(finish);
      }

      expect(finishes.at(-1)?.text).toContain('Olena');
      const saved = await history();
      expect(saved.filter((message) => message.role === Type.LLM.UnifiedMessageRole.user)).toHaveLength(3);
      expect(saved.filter((message) => message.role === Type.LLM.UnifiedMessageRole.assistant)).toHaveLength(3);
    }, 120000);

    it('two tools in one step: tool-call, data and tool-result in step 0, data between its own call and result, never saved', async () => {
      const { ask, history } = await setup();
      const events: StreamEvent[] = [];

      const result = await ask(
        'What is the weather and the local time in Kyiv right now? Call get_weather and get_local_time together, in one step.',
        {
          additionalTools: [weatherTool, localTimeTool],
          streamOptions: { include: { toolCalls: 'args' } },
          onEvent: (event) => events.push(event)
        }
      );
      await result.messages.save();
      report(provider, 'parallel tools', events);

      expectWellFormed(events);
      expectStepOrder(events);
      const calls = ofType(events, 'tool-call');
      expect(calls.map((event) => event.step)).toEqual([0, 0]);
      expect(calls.map((event) => event.name).sort()).toEqual(['get_local_time', 'get_weather']);
      for (const call of calls) expect(call.args).toEqual({ city: expect.stringMatching(/kyiv/i) });

      const weatherCall = calls.find((event) => event.name === 'get_weather');
      const [data] = ofType(events, 'data');
      expect(ofType(events, 'data')).toHaveLength(1);
      expect(data).toMatchObject({
        step: 0,
        toolCallId: weatherCall?.toolCallId,
        toolName: 'get_weather',
        name: 'progress',
        data: { stage: 'looking up' }
      });
      const results = ofType(events, 'tool-result');
      expect(results).toHaveLength(2);
      expect(results.every((event) => event.step === 0 && event.status === 'succeeded')).toBe(true);
      expect(new Set(results.map((event) => event.toolCallId))).toEqual(
        new Set(calls.map((event) => event.toolCallId))
      );
      expect(ofType(events, 'step-finish')[0]).toMatchObject({ step: 0, hadToolCalls: true });

      const steps = ofType(events, 'step-finish');
      const lastStep = steps.at(-1)?.step;
      expect(lastStep).toBeGreaterThan(0);
      const answerDeltas = ofType(events, 'text-delta').filter((event) => event.step === lastStep);
      expect(answerDeltas.length).toBeGreaterThan(0);
      const [finish] = ofType(events, 'finish');
      expect(finish.text).toBe(answerDeltas.map((event) => event.delta).join(''));

      // The data payload goes to the caller only; the history holds the tool results
      expect(JSON.stringify(await history())).not.toContain('looking up');
    }, 90000);

    it('a long answer of at least 400 tokens finishes with a 5 s idle timeout that never fires', async () => {
      const idleTimeoutMs = 5000;
      const { ask } = await setup({ extras: { streamIdleTimeoutMs: idleTimeoutMs } });
      const events: StreamEvent[] = [];
      const arrivals: number[] = [];

      const startedAt = Date.now();
      await ask('Without using any tool, write a story of about 500 words about a lighthouse keeper.', {
        onEvent: (event) => {
          events.push(event);
          if (event.type === 'text-delta') arrivals.push(Date.now());
        }
      });
      const durationMs = Date.now() - startedAt;
      const longestGapMs = Math.max(0, ...arrivals.slice(1).map((time, index) => time - arrivals[index]));
      report(
        provider,
        'long answer',
        events,
        `duration ${durationMs} ms, longest gap between deltas ${longestGapMs} ms`
      );

      expectWellFormed(events);
      expectStepOrder(events);
      expect(ofType(events, 'error')).toHaveLength(0);
      const [finish] = ofType(events, 'finish');
      expect(finish.usage.outputTokens).toBeGreaterThanOrEqual(400);
      const deltas = ofType(events, 'text-delta');
      expect(deltas.length).toBeGreaterThan(10);
      expect(finish.text).toBe(deltas.map((event) => event.delta).join(''));
      expect(longestGapMs).toBeLessThan(idleTimeoutMs);
    }, 120000);

    it('abort after the third text-delta: exactly three deltas, one abort event, generate rejects, nothing saved', async () => {
      const { ask, history } = await setup();
      const controller = new AbortController();
      const events: StreamEvent[] = [];
      let deltas = 0;

      const generation = ask('Without using any tool, write a 300-word story about a lighthouse keeper.', {
        signal: controller.signal,
        onEvent: (event) => {
          events.push(event);
          if (event.type === 'text-delta') {
            deltas += 1;
            if (deltas === 3) controller.abort();
          }
        }
      });

      const error = await generation.catch((caught: unknown) => caught);
      report(provider, 'abort after third delta', events);
      expect(error).toBeInstanceOf(GenerateError);
      const { cause } = error as GenerateError;
      if (provider.abortCause.constructorName) {
        expect(cause?.constructor.name).toBe(provider.abortCause.constructorName);
      }
      if (provider.abortCause.name) expect(cause).toMatchObject({ name: provider.abortCause.name });

      expectWellFormed(events);
      expectStepOrder(events);
      expect(ofType(events, 'abort')).toHaveLength(1);
      expect(ofType(events, 'text-delta')).toHaveLength(3);
      expect(ofType(events, 'finish')).toHaveLength(0);
      expect(ofType(events, 'step-finish')).toHaveLength(0);
      expect(await history()).toHaveLength(0);
    }, 60000);

    it('after-middleware policy with an uppercasing AfterGenerate middleware: no text while the model writes, one final uppercase text, saved as sent', async () => {
      const { ask, savedReply } = await setup({
        configure: (chatConstructor) => chatConstructor.registerAfterGenerateMiddleware('shout', shout)
      });
      const events: StreamEvent[] = [];

      const result = await ask('Without using any tool, name three planets of the solar system in one sentence.', {
        streamOptions: { textPolicy: 'after-middleware' },
        onEvent: (event) => events.push(event)
      });
      await result.messages.save();
      report(provider, 'after-middleware', events);

      expectWellFormed(events);
      expectStepOrder(events);
      expect(events[0]).toMatchObject({ type: 'start', textPolicy: 'after-middleware', streaming: false });
      const [finish] = ofType(events, 'finish');
      expect(finish.text).not.toBe('');
      expect(finish.text).toBe(finish.text.toUpperCase());
      // The only text-delta is the final text, in a step of its own after the model's step
      const deltas = ofType(events, 'text-delta');
      expect(deltas).toHaveLength(1);
      expect(deltas[0].delta).toBe(finish.text);
      const steps = ofType(events, 'step-finish');
      expect(steps.length).toBeGreaterThan(1);
      expect(deltas[0].step).toBe(steps.at(-1)?.step);
      expect(steps.every((event) => !event.streamed)).toBe(true);
      expect(textOf(await savedReply())).toBe(finish.text);
    }, 60000);

    it('observe-only (enabled: false) sends each step text once and its finish.text has the shape of a streamed run', async () => {
      const { ask, newSession, savedReply } = await setup();
      const prompt = 'Without using any tool, name the three primary colours of paint in one short sentence.';

      const streamed: StreamEvent[] = [];
      const streamedResult = await ask(prompt, { onEvent: (event) => streamed.push(event) });
      await streamedResult.messages.save();
      report(provider, 'observe-only: streamed run', streamed);

      const other = await newSession();
      const observed: StreamEvent[] = [];
      const observedResult = await ask(
        prompt,
        { streamOptions: { enabled: false }, onEvent: (event) => observed.push(event) },
        other.id
      );
      await observedResult.messages.save();
      report(provider, 'observe-only: observed run', observed);

      expectWellFormed(streamed);
      expectStepOrder(streamed);
      expectWellFormed(observed);
      expectStepOrder(observed);
      expect(streamed[0]).toMatchObject({ type: 'start', textPolicy: 'all', streaming: true });
      expect(observed[0]).toMatchObject({ type: 'start', textPolicy: 'all', streaming: false });

      const [streamedFinish] = ofType(streamed, 'finish');
      const [observedFinish] = ofType(observed, 'finish');
      // Observe-only: one text-delta per step, sent after the provider call, with the step's whole text
      expect(ofType(observed, 'step-finish').map((event) => event.streamed)).toEqual([false]);
      const observedDeltas = ofType(observed, 'text-delta');
      expect(observedDeltas).toHaveLength(1);
      expect(observedDeltas[0].delta).toBe(observedFinish.text);
      expect(ofType(streamed, 'step-finish').map((event) => event.streamed)).toEqual([true]);

      // Both runs: finish.text is the saved reply, untouched, with the same finish reason
      for (const [finish, sessionId] of [
        [streamedFinish, streamedResult.sessionId],
        [observedFinish, other.id]
      ] as const) {
        expect(finish.text).not.toBe('');
        expect(finish.textReplaced).toBe(false);
        expect(textOf(await savedReply(sessionId))).toBe(finish.text);
      }
      expect(observedFinish.finishReason).toBe(streamedFinish.finishReason);
      expect(observedFinish.usage.outputTokens).toBeGreaterThan(0);
    }, 90000);

    it.runIf(provider.structuredLlmName !== undefined)(
      'a reply with a JSON schema ends with one finish whose text is the JSON answer',
      async () => {
        const { ask } = await setup({ llmName: provider.structuredLlmName });
        const events: StreamEvent[] = [];

        await ask('What is the capital of France?', { onEvent: (event) => events.push(event) });
        report(provider, 'json schema', events);

        expectWellFormed(events);
        expectStepOrder(events);
        const steps = ofType(events, 'step-finish');
        expect(steps.map((event) => event.streamed)).toEqual([provider.structuredStreams]);
        const deltas = ofType(events, 'text-delta');
        if (!provider.structuredStreams) expect(deltas).toHaveLength(1);
        const [finish] = ofType(events, 'finish');
        expect(finish.text).toBe(deltas.map((event) => event.delta).join(''));
        expect(JSON.parse(finish.text)).toEqual({ answer: expect.stringContaining('Paris') });
      },
      60000
    );
  });
}
