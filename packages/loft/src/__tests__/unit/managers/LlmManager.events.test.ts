import 'reflect-metadata';

import { Chat, ContextInterface, Interface, Logger, Strategy, Type } from '@moc-global/loft-definitions';
import { mcpTools, ScriptedLLMStrategy } from '@moc-global/loft-test-suite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LlmManager } from '../../../managers/LlmManager';
import { ToolInterceptorManager } from '../../../managers/ToolInterceptorManager';

const LLM = 'scripted';
const MANIFEST = 'assistant';
const SESSION_ID = 'session-1';
const MAX_CALLS = 5;

// LlmManager also ends a generation with its completionStartTime, which the tracer interface does not declare
type GenerationEndParams = Parameters<Strategy.Tracer.Generation['end']>[0] & { completionStartTime?: Date };

// The usage ScriptedLLMStrategy reports for every response
const scriptedUsage = (finishReason: 'stop' | 'tool_calls'): Strategy.LLM.StreamUsage => ({
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  model: 'scripted',
  finishReason
});

type SinkCall =
  | { method: 'stepStart'; step: number }
  | { method: 'provider'; step: number }
  | { method: 'providerEvent'; step: number; event: Strategy.LLM.LlmStreamEvent }
  | { method: 'stepText'; step: number; text: string }
  | { method: 'toolCall'; step: number; call: Parameters<Chat.GenerationEventSink['toolCall']>[1] }
  | {
      method: 'data';
      step: number;
      tool: Parameters<Chat.GenerationEventSink['data']>[1];
      name: string;
      data: unknown;
    }
  | { method: 'toolResult'; step: number; result: Parameters<Chat.GenerationEventSink['toolResult']>[1] }
  | { method: 'stepFinish'; step: number; info: Parameters<Chat.GenerationEventSink['stepFinish']>[1] }
  | { method: 'markSynthetic' }
  | { method: 'loopLimitReached' };

// Records every report LlmManager makes, in order
class RecordingSink implements Chat.GenerationEventSink {
  readonly calls: SinkCall[] = [];
  private nextStep = 0;

  constructor(
    private readonly options: { observeOnly?: boolean; firstOutputAt?: (step: number) => Date | undefined } = {}
  ) {}

  stepStart(): number {
    const step = this.nextStep++;
    this.calls.push({ method: 'stepStart', step });
    return step;
  }

  provider(step: number): Strategy.LLM.LlmStreamSink | undefined {
    this.calls.push({ method: 'provider', step });
    if (this.options.observeOnly) return undefined;
    return (event) => {
      this.calls.push({ method: 'providerEvent', step, event });
      return true;
    };
  }

  stepText(step: number, text: string): void {
    this.calls.push({ method: 'stepText', step, text });
  }

  toolCall(step: number, call: Parameters<Chat.GenerationEventSink['toolCall']>[1]): void {
    this.calls.push({ method: 'toolCall', step, call });
  }

  data(step: number, tool: Parameters<Chat.GenerationEventSink['data']>[1], name: string, data: unknown): void {
    this.calls.push({ method: 'data', step, tool, name, data });
  }

  toolResult(step: number, result: Parameters<Chat.GenerationEventSink['toolResult']>[1]): void {
    this.calls.push({ method: 'toolResult', step, result });
  }

  stepFinish(step: number, info: Parameters<Chat.GenerationEventSink['stepFinish']>[1]): void {
    this.calls.push({ method: 'stepFinish', step, info });
  }

  markSynthetic(): void {
    this.calls.push({ method: 'markSynthetic' });
  }

  loopLimitReached(): void {
    this.calls.push({ method: 'loopLimitReached' });
  }

  firstOutputAt(step: number): Date | undefined {
    return this.options.firstOutputAt?.(step);
  }

  /** The recorded methods, in order */
  get methods(): string[] {
    return this.calls.map((call) => call.method);
  }

  callsOf<M extends SinkCall['method']>(method: M): Extract<SinkCall, { method: M }>[] {
    return this.calls.filter((call): call is Extract<SinkCall, { method: M }> => call.method === method);
  }
}

// Records how each LLM generation is ended; spans are not asserted here
class GenerationTracer implements Strategy.Tracer.Tracer {
  constructor(private readonly ends: (GenerationEndParams | undefined)[]) {}

  withParent(): Strategy.Tracer.Tracer {
    return this;
  }

  span(): Strategy.Tracer.Span {
    return {
      id: 'span',
      end: () => undefined,
      span: () => this.span(),
      generation: (params) => this.generation(params),
      event: () => undefined
    };
  }

  generation(_params: Parameters<Strategy.Tracer.Tracer['generation']>[0]): Strategy.Tracer.Generation {
    const index = this.ends.length;
    return {
      id: `generation-${index + 1}`,
      end: (params?: GenerationEndParams) => {
        this.ends[index] = params;
      }
    };
  }

  event(): void {}
  score(): void {}
  update(): void {}
  async flushAsync(): Promise<void> {}
}

interface Setup {
  replies: ConstructorParameters<typeof ScriptedLLMStrategy>[1];
  additionalTools?: Chat.AdditionalTool[];
  interceptors?: Record<string, Interface.ToolInterceptor>;
  callTool?: Interface.MCP.MCPManager['callTool'];
  maxCalls?: number;
  callOptions?: Interface.LlmGenerateOptions;
}

async function generate({ replies, additionalTools, interceptors, callTool, maxCalls, callOptions }: Setup) {
  const llm = new ScriptedLLMStrategy(LLM, replies);
  const strategyGenerate = vi.spyOn(llm, 'generate');
  const generationEnds: (GenerationEndParams | undefined)[] = [];

  const manifestManager = {
    useLlmManifestSchema: vi.fn().mockResolvedValue(undefined),
    getLlmManifest: vi.fn().mockResolvedValue({ systemMessage: 'You help.', modelPreset: { model: 'scripted' } })
  } as unknown as Interface.ManifestManager;
  const computerManager = {
    compute: vi.fn().mockResolvedValue('You help.')
  } as unknown as Interface.ComputerManager<ContextInterface>;
  const mcpManager = {
    listTools: vi.fn().mockResolvedValue(mcpTools),
    callTool: vi.fn(
      callTool ?? (async () => ({ content: [{ type: 'text' as const, text: '18°C, cloudy' }], isError: false }))
    ),
    getClientsInfoForTool: vi.fn().mockResolvedValue(new Map([['weather-server', { transportType: 'memory' }]]))
  } as unknown as Interface.MCP.MCPManager;
  const cropper = {
    crop: (messages: Type.Entity.Message[]) => messages
  } as unknown as Strategy.LlmContextWindowCropper;

  const toolInterceptorManager = new ToolInterceptorManager();
  for (const [toolName, interceptor] of Object.entries(interceptors ?? {})) {
    toolInterceptorManager.use(toolName, interceptor);
  }

  const llmManager = new LlmManager(
    manifestManager,
    computerManager,
    computerManager,
    computerManager,
    mcpManager,
    cropper,
    toolInterceptorManager,
    { mcp: { maxCallsPerGenerate: maxCalls ?? MAX_CALLS } }
  );
  await llmManager.use(LLM, llm, false);

  const ctx = {
    request: { correlatorIds: ['correlator-1'], messages: { augmentedContext: [], directMessages: [] } },
    session: { id: SESSION_ID },
    tracer: new GenerationTracer(generationEnds)
  } as unknown as ContextInterface;

  const userMessage: Type.Entity.CreateMessage = {
    sessionId: SESSION_ID,
    ctx: {},
    content: [{ type: 'text', text: 'Hello' }],
    role: Type.LLM.UnifiedMessageRole.user,
    author: 'user',
    llmName: LLM,
    manifestName: MANIFEST,
    llmIgnore: false
  };

  const response = await llmManager.generate(
    ctx,
    LLM,
    MANIFEST,
    [userMessage],
    additionalTools,
    undefined,
    callOptions
  );
  return { response, llm, strategyGenerate, generationEnds };
}

const textResult = (text: string, isError?: boolean): Chat.AdditionalToolResult => ({
  content: [{ type: Chat.AdditionalToolContentType.TEXT, text }],
  ...(isError !== undefined && { isError })
});

const lookupOrder = (handler: Chat.AdditionalTool['handler']): Chat.AdditionalTool => ({
  definition: {
    name: 'lookup_order',
    description: 'Looks up an order',
    inputSchema: { type: Chat.AdditionalToolSchemaType.OBJECT, properties: { id: { type: 'string' } } }
  },
  handler
});

const shippedOrder = () => lookupOrder(async () => textResult('Order 42 shipped'));

// An interceptor that runs the tool and replaces the LLM's next reply
const overridingInterceptor: Interface.ToolInterceptor = async ({ toolRequest, executeToolFn, preventGenerate }) => {
  preventGenerate({
    content: [{ type: 'text', text: 'Here is the weather card.' }],
    role: Type.LLM.UnifiedMessageRole.assistant
  });
  return executeToolFn({ params: toolRequest.params });
};

const anyDuration = expect.any(Number) as unknown as number;

describe('LlmManager generation events', () => {
  afterEach(() => {
    Logger.configure();
  });

  it('one step: step-start, deltas, step-finish', async () => {
    const sink = new RecordingSink();

    await generate({
      replies: [{ text: 'Hello there', chunks: ['Hello', ' there'] }],
      callOptions: { events: sink }
    });

    expect(sink.calls).toEqual([
      { method: 'stepStart', step: 0 },
      { method: 'provider', step: 0 },
      { method: 'providerEvent', step: 0, event: { type: 'text-delta', delta: 'Hello' } },
      { method: 'providerEvent', step: 0, event: { type: 'text-delta', delta: ' there' } },
      { method: 'stepText', step: 0, text: 'Hello there' },
      {
        method: 'stepFinish',
        step: 0,
        info: { finishReason: 'stop', hadToolCalls: false, usage: scriptedUsage('stop') }
      }
    ]);
  });

  it('tool round then answer: two steps, tool events inside step 0', async () => {
    const sink = new RecordingSink();

    await generate({
      replies: [
        { toolCalls: [{ name: 'lookup_order', arguments: { id: '42' }, callId: 'call-1' }] },
        { text: 'Done.', chunks: ['Done.'] }
      ],
      additionalTools: [shippedOrder()],
      callOptions: { events: sink }
    });

    expect(sink.calls).toEqual([
      { method: 'stepStart', step: 0 },
      { method: 'provider', step: 0 },
      { method: 'stepText', step: 0, text: '' },
      { method: 'toolCall', step: 0, call: { toolCallId: 'call-1', name: 'lookup_order', args: { id: '42' } } },
      {
        method: 'toolResult',
        step: 0,
        result: { toolCallId: 'call-1', name: 'lookup_order', status: 'succeeded', durationMs: anyDuration }
      },
      {
        method: 'stepFinish',
        step: 0,
        info: { finishReason: 'tool_calls', hadToolCalls: true, usage: scriptedUsage('tool_calls') }
      },
      { method: 'stepStart', step: 1 },
      { method: 'provider', step: 1 },
      { method: 'providerEvent', step: 1, event: { type: 'text-delta', delta: 'Done.' } },
      { method: 'stepText', step: 1, text: 'Done.' },
      {
        method: 'stepFinish',
        step: 1,
        info: { finishReason: 'stop', hadToolCalls: false, usage: scriptedUsage('stop') }
      }
    ]);
    const [toolResult] = sink.callsOf('toolResult');
    expect(toolResult.result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('tool events in execution order', async () => {
    const sink = new RecordingSink();

    await generate({
      replies: [
        {
          toolCalls: [
            { name: 'get_weather', arguments: { city: 'Kyiv' }, callId: 'call-1' },
            { name: 'no_such_tool', callId: 'call-2' },
            { name: 'lookup_order', arguments: { id: '42' }, callId: 'call-3' }
          ]
        },
        { text: 'Done.' }
      ],
      additionalTools: [shippedOrder()],
      callOptions: { events: sink }
    });

    // The unsupported call is answered first, then the additional tools, then the MCP tools, as they run
    const toolEvents = sink.calls
      .filter((call) => call.method === 'toolCall' || call.method === 'toolResult')
      .map((call) =>
        call.method === 'toolCall'
          ? `call ${call.call.toolCallId} ${call.call.name}`
          : `result ${call.result.toolCallId} ${call.result.name} ${call.result.status}`
      );
    expect(toolEvents).toEqual([
      'call call-2 unknown',
      'result call-2 unknown failed',
      'call call-3 lookup_order',
      'result call-3 lookup_order succeeded',
      'call call-1 get_weather',
      'result call-1 get_weather succeeded'
    ]);
    expect(sink.methods.slice(0, 3)).toEqual(['stepStart', 'provider', 'stepText']);
    expect(sink.methods.slice(-4)).toEqual(['stepStart', 'provider', 'stepText', 'stepFinish']);
  });

  it("unsupported tool name is reported as 'unknown'", async () => {
    const sink = new RecordingSink();

    const { response } = await generate({
      replies: [
        { toolCalls: [{ name: 'made_up_tool', arguments: { secret: 'model-made' }, callId: 'call-1' }] },
        { text: 'Sorry.' }
      ],
      callOptions: { events: sink }
    });

    expect(sink.callsOf('toolCall')).toEqual([
      { method: 'toolCall', step: 0, call: { toolCallId: 'call-1', name: 'unknown', args: {} } }
    ]);
    expect(sink.callsOf('toolResult')).toEqual([
      {
        method: 'toolResult',
        step: 0,
        result: { toolCallId: 'call-1', name: 'unknown', status: 'failed', durationMs: 0 }
      }
    ]);
    const reported = JSON.stringify(sink.calls);
    expect(reported).not.toContain('made_up_tool');
    expect(reported).not.toContain('model-made');
    // The tool chain still names the tool, as without events
    expect(response.usedTools?.[1].author).toBe('tool-made_up_tool');
  });

  describe('tool-result failed when the tool result is an error', () => {
    const statusOf = (sink: RecordingSink) => sink.callsOf('toolResult').map((call) => call.result.status);

    it('a handler that throws', async () => {
      const sink = new RecordingSink();
      await generate({
        replies: [{ toolCalls: [{ name: 'lookup_order', callId: 'call-1' }] }, { text: 'Sorry.' }],
        additionalTools: [
          lookupOrder(async () => {
            throw new Error('Order service down');
          })
        ],
        callOptions: { events: sink }
      });
      expect(statusOf(sink)).toEqual(['failed']);
    });

    it('a handler result marked as an error', async () => {
      const sink = new RecordingSink();
      await generate({
        replies: [{ toolCalls: [{ name: 'lookup_order', callId: 'call-1' }] }, { text: 'Sorry.' }],
        additionalTools: [lookupOrder(async () => textResult('No such order', true))],
        callOptions: { events: sink }
      });
      expect(statusOf(sink)).toEqual(['failed']);
    });

    it('an MCP result marked as an error', async () => {
      const sink = new RecordingSink();
      await generate({
        replies: [{ toolCalls: [{ name: 'get_weather', callId: 'call-1' }] }, { text: 'Sorry.' }],
        callTool: async () => ({ content: [{ type: 'text', text: 'No data for Kyiv' }], isError: true }),
        callOptions: { events: sink }
      });
      expect(statusOf(sink)).toEqual(['failed']);
    });

    it('an MCP tool that throws', async () => {
      const sink = new RecordingSink();
      await generate({
        replies: [{ toolCalls: [{ name: 'get_weather', callId: 'call-1' }] }, { text: 'Sorry.' }],
        callTool: async () => {
          throw new Error('Weather service down');
        },
        callOptions: { events: sink }
      });
      expect(statusOf(sink)).toEqual(['failed']);
    });

    it('an unsupported tool', async () => {
      const sink = new RecordingSink();
      await generate({
        replies: [{ toolCalls: [{ name: 'no_such_tool', callId: 'call-1' }] }, { text: 'Sorry.' }],
        callOptions: { events: sink }
      });
      expect(statusOf(sink)).toEqual(['failed']);
    });

    it('an interceptor override whose tool result is an error', async () => {
      const sink = new RecordingSink();
      await generate({
        replies: [{ toolCalls: [{ name: 'get_weather', callId: 'call-1' }] }],
        interceptors: { get_weather: overridingInterceptor },
        callTool: async () => ({ content: [{ type: 'text', text: 'No data for Kyiv' }], isError: true }),
        callOptions: { events: sink }
      });
      expect(statusOf(sink)).toEqual(['failed']);
    });

    it('succeeded otherwise', async () => {
      const sink = new RecordingSink();
      await generate({
        replies: [
          {
            toolCalls: [
              { name: 'lookup_order', callId: 'call-1' },
              { name: 'get_weather', callId: 'call-2' }
            ]
          },
          { text: 'Done.' }
        ],
        additionalTools: [lookupOrder(async () => textResult('Order 42 shipped', false))],
        callOptions: { events: sink }
      });
      expect(statusOf(sink)).toEqual(['succeeded', 'succeeded']);
    });
  });

  describe('step-finish called once on every exit path', () => {
    // Every step that started finished exactly once, and nothing came after its step-finish
    const expectEachStepFinishedOnce = (sink: RecordingSink, steps: number) => {
      const started = sink.callsOf('stepStart').map((call) => call.step);
      const finished = sink.callsOf('stepFinish').map((call) => call.step);
      expect(started).toEqual(Array.from({ length: steps }, (_, step) => step));
      expect(finished).toEqual(started);
      for (const step of started) {
        const finishIndex = sink.calls.findIndex((call) => call.method === 'stepFinish' && call.step === step);
        const laterInStep = sink.calls
          .slice(finishIndex + 1)
          .filter((call) => 'step' in call && call.step === step && call.method !== 'stepStart');
        expect(laterInStep).toEqual([]);
      }
    };

    it('no tools requested', async () => {
      const sink = new RecordingSink();
      await generate({ replies: [{ text: 'Hi.' }], callOptions: { events: sink } });

      expectEachStepFinishedOnce(sink, 1);
      expect(sink.callsOf('stepFinish')[0].info.hadToolCalls).toBe(false);
    });

    it('the tool loop limit', async () => {
      const sink = new RecordingSink();
      await generate({
        replies: [
          { toolCalls: [{ name: 'ping', callId: 'call-1' }] },
          { toolCalls: [{ name: 'ping', callId: 'call-2' }] }
        ],
        maxCalls: 2,
        callOptions: { events: sink }
      });

      expectEachStepFinishedOnce(sink, 2);
      // The limit is reported before the last step finishes; that step's tools never run
      expect(sink.methods.slice(-3)).toEqual(['stepText', 'loopLimitReached', 'stepFinish']);
      expect(sink.callsOf('toolCall').map((call) => call.call.toolCallId)).toEqual(['call-1']);
      expect(sink.callsOf('stepFinish')[1].info).toEqual({
        finishReason: 'tool_calls',
        hadToolCalls: true,
        usage: scriptedUsage('tool_calls')
      });
    });

    it('after the tool loop', async () => {
      const sink = new RecordingSink();
      await generate({
        replies: [
          {
            toolCalls: [
              { name: 'ping', callId: 'call-1' },
              { name: 'no_such_tool', callId: 'call-2' }
            ]
          },
          { toolCalls: [{ name: 'no_such_tool', callId: 'call-3' }] },
          { text: 'Done.' }
        ],
        callOptions: { events: sink }
      });

      expectEachStepFinishedOnce(sink, 3);
      expect(sink.callsOf('stepFinish').map((call) => call.info.hadToolCalls)).toEqual([true, true, false]);
    });

    it('an interceptor override', async () => {
      const sink = new RecordingSink();
      await generate({
        replies: [{ toolCalls: [{ name: 'get_weather', callId: 'call-1' }] }],
        interceptors: { get_weather: overridingInterceptor },
        callOptions: { events: sink }
      });

      expectEachStepFinishedOnce(sink, 1);
    });
  });

  it('interceptor override marked synthetic and the step finishes once', async () => {
    const sink = new RecordingSink();

    const { response, llm } = await generate({
      replies: [
        {
          toolCalls: [
            { name: 'get_weather', arguments: { city: 'Kyiv' }, callId: 'call-1' },
            { name: 'ping', callId: 'call-2' }
          ]
        }
      ],
      interceptors: { get_weather: overridingInterceptor },
      callOptions: { events: sink }
    });

    expect(llm.calls).toHaveLength(1);
    expect(response.usage.finishReason).toBe('interceptor_override');
    expect(sink.methods).toEqual([
      'stepStart',
      'provider',
      'stepText',
      'toolCall',
      'toolResult',
      'markSynthetic',
      'stepFinish'
    ]);
    // The step reports the model's own response, not the override
    expect(sink.callsOf('stepFinish')).toEqual([
      {
        method: 'stepFinish',
        step: 0,
        info: { finishReason: 'tool_calls', hadToolCalls: true, usage: scriptedUsage('tool_calls') }
      }
    ]);
  });

  it('tool emit becomes a data event between tool-call and tool-result', async () => {
    const sink = new RecordingSink();
    const handler = vi.fn(async (_args: Record<string, unknown>, context?: Chat.AdditionalToolContext) => {
      context?.emit('progress', { done: 1, of: 2 });
      context?.emit('progress', { done: 2, of: 2 });
      return textResult('Order 42 shipped');
    });

    await generate({
      replies: [
        { toolCalls: [{ name: 'lookup_order', arguments: { id: '42' }, callId: 'call-1' }] },
        { text: 'Done.' }
      ],
      additionalTools: [lookupOrder(handler)],
      callOptions: { events: sink }
    });

    const tool = { toolCallId: 'call-1', toolName: 'lookup_order' };
    expect(sink.calls.filter((call) => ['toolCall', 'data', 'toolResult'].includes(call.method))).toEqual([
      { method: 'toolCall', step: 0, call: { toolCallId: 'call-1', name: 'lookup_order', args: { id: '42' } } },
      { method: 'data', step: 0, tool, name: 'progress', data: { done: 1, of: 2 } },
      { method: 'data', step: 0, tool, name: 'progress', data: { done: 2, of: 2 } },
      {
        method: 'toolResult',
        step: 0,
        result: { toolCallId: 'call-1', name: 'lookup_order', status: 'succeeded', durationMs: anyDuration }
      }
    ]);
  });

  it('data events are never saved', async () => {
    const sentinel = 'SENTINEL-data-4711';
    const sink = new RecordingSink();

    const { response, llm } = await generate({
      replies: [{ toolCalls: [{ name: 'lookup_order', callId: 'call-1' }] }, { text: 'Done.' }],
      additionalTools: [
        lookupOrder(async (_args, context) => {
          context?.emit('card', { note: sentinel });
          return textResult('Order 42 shipped');
        })
      ],
      callOptions: { events: sink }
    });

    expect(sink.callsOf('data')).toHaveLength(1);
    expect(JSON.stringify(response)).not.toContain(sentinel);
    expect(JSON.stringify(llm.calls)).not.toContain(sentinel);
    expect(response.usedTools?.[1].content).toEqual([
      { type: 'tool_result', callId: 'call-1', content: [{ type: 'text', text: 'Order 42 shipped' }], isError: false }
    ]);
  });

  it('strategies never receive the events object', async () => {
    const controller = new AbortController();
    const sink = new RecordingSink();

    const { strategyGenerate } = await generate({
      replies: [{ toolCalls: [{ name: 'lookup_order', callId: 'call-1' }] }, { text: 'Done.' }],
      additionalTools: [shippedOrder()],
      callOptions: { signal: controller.signal, events: sink }
    });

    expect(strategyGenerate).toHaveBeenCalledTimes(2);
    for (const [, options] of strategyGenerate.mock.calls) {
      expect(Object.keys(options ?? {}).sort()).toEqual(['onEvent', 'signal']);
      expect(options?.signal).toBe(controller.signal);
      expect(options?.onEvent).toEqual(expect.any(Function));
      expect(Object.values(options ?? {})).not.toContain(sink);
    }
  });

  it('provider options never contain events', async () => {
    // A sink that only observes gives the provider no onEvent at all
    const sink = new RecordingSink({ observeOnly: true });

    const { strategyGenerate } = await generate({
      replies: [{ text: 'Hello there', chunks: ['Hello', ' there'] }],
      callOptions: { events: sink }
    });

    const [[, options]] = strategyGenerate.mock.calls;
    expect(options).toStrictEqual({ signal: undefined, onEvent: undefined });
    expect(options).not.toHaveProperty('events');
    // The provider did not stream, so the step's text comes from the formatted response
    expect(sink.callsOf('providerEvent')).toEqual([]);
    expect(sink.callsOf('stepText')).toEqual([{ method: 'stepText', step: 0, text: 'Hello there' }]);
  });

  it("no events: provider receives today's options", async () => {
    const { signal } = new AbortController();

    const withOptions = await generate({
      replies: [{ text: 'Hi.', chunks: ['Hi.'] }],
      callOptions: { signal, events: undefined }
    });
    const withoutOptions = await generate({ replies: [{ text: 'Hi.' }] });

    const options = withOptions.strategyGenerate.mock.calls[0][1];
    expect(options).toEqual({ signal });
    expect(options?.signal).toBe(signal);
    expect(options).not.toHaveProperty('events');
    expect(withoutOptions.strategyGenerate.mock.calls[0][1]).toBeUndefined();
  });

  it('first-output time becomes completionStartTime', async () => {
    const firstOutput = new Date('2026-01-02T03:04:05.000Z');
    const sink = new RecordingSink({ firstOutputAt: (step) => (step === 0 ? firstOutput : undefined) });
    const before = new Date();

    const { generationEnds } = await generate({
      replies: [{ toolCalls: [{ name: 'ping', callId: 'call-1' }] }, { text: 'Done.' }],
      callOptions: { events: sink }
    });

    expect(generationEnds).toHaveLength(2);
    expect(generationEnds[0]?.completionStartTime).toBe(firstOutput);
    // A step without output keeps the request start
    const requestStart = generationEnds[1]?.completionStartTime;
    expect(requestStart).toBeInstanceOf(Date);
    expect(requestStart?.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('no events option means no sink calls', async () => {
    // Only Date is faked, so the request start is a known time and promises and timers run as usual
    const requestStart = new Date('2026-03-04T05:06:07.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(requestStart);
    const { signal } = new AbortController();
    let emitResult: (() => void) | undefined;

    try {
      const { response, strategyGenerate, generationEnds } = await generate({
        replies: [
          {
            toolCalls: [
              { name: 'lookup_order', callId: 'call-1' },
              { name: 'no_such_tool', callId: 'call-2' }
            ]
          },
          { text: 'Done.', chunks: ['Do', 'ne.'] }
        ],
        additionalTools: [
          lookupOrder(async (_args, context) => {
            emitResult = () => context?.emit('progress', { done: 1 });
            return textResult('Order 42 shipped');
          })
        ],
        callOptions: { signal }
      });

      // The strategy gets the signal and nothing else, on every call
      expect(strategyGenerate.mock.calls.map(([, options]) => options)).toEqual([{ signal }, { signal }]);
      for (const [, options] of strategyGenerate.mock.calls) {
        expect(options).not.toHaveProperty('events');
        expect(options).not.toHaveProperty('onEvent');
      }
      // The handler's emit does nothing, also when called after the tool finished
      expect(emitResult).toBeDefined();
      expect(() => emitResult?.()).not.toThrow();
      expect(response.topChoice.content).toEqual([{ type: 'text', text: 'Done.' }]);
      expect(generationEnds.map((end) => end?.completionStartTime)).toEqual([requestStart, requestStart]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a provider error leaves the step open', async () => {
    const sink = new RecordingSink();

    await expect(
      generate({ replies: [{ error: new Error('Provider down') }], callOptions: { events: sink } })
    ).rejects.toThrow('Provider down');

    expect(sink.methods).toEqual(['stepStart', 'provider']);
  });

  it('an abort between tools runs no further tool and leaves the step open', async () => {
    const controller = new AbortController();
    const sink = new RecordingSink();

    await expect(
      generate({
        replies: [
          {
            toolCalls: [
              { name: 'lookup_order', callId: 'call-1' },
              { name: 'get_weather', callId: 'call-2' }
            ]
          },
          { text: 'Done.' }
        ],
        additionalTools: [
          lookupOrder(async () => {
            controller.abort();
            return textResult('Order 42 shipped');
          })
        ],
        callOptions: { signal: controller.signal, events: sink }
      })
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(sink.methods).toEqual(['stepStart', 'provider', 'stepText', 'toolCall', 'toolResult']);
    expect(sink.callsOf('toolCall').map((call) => call.call.toolCallId)).toEqual(['call-1']);
  });
});
