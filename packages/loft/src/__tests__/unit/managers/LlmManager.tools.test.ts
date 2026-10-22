import 'reflect-metadata';

import { Chat, ContextInterface, Interface, Logger, Strategy, Type } from '@moc-global/loft-definitions';
import { configureMockLoggerStrategy, mcpTools, ScriptedLLMStrategy } from '@moc-global/loft-test-suite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LlmManager } from '../../../managers/LlmManager';
import { ToolInterceptorManager } from '../../../managers/ToolInterceptorManager';

const LLM = 'scripted';
const MANIFEST = 'assistant';
const SESSION_ID = 'session-1';
const MAX_CALLS = 5;

type SpanParams = Parameters<Strategy.Tracer.Tracer['span']>[0];
type SpanEndParams = Parameters<Strategy.Tracer.Span['end']>[0];

interface RecordedSpan {
  name: string;
  input: unknown;
  metadata: SpanParams['metadata'];
  parentId: string | undefined;
  end?: SpanEndParams;
}

// Records the spans LlmManager opens and how it ends them; generations only get ids to parent the spans
class SpyTracer implements Strategy.Tracer.Tracer {
  constructor(
    private readonly record: { spans: RecordedSpan[]; generations: number },
    private readonly parentId?: string
  ) {}

  get spans(): RecordedSpan[] {
    return this.record.spans;
  }

  withParent(parentId: string): Strategy.Tracer.Tracer {
    return new SpyTracer(this.record, parentId);
  }

  span(params: SpanParams): Strategy.Tracer.Span {
    const recorded: RecordedSpan = {
      name: params.name,
      input: params.input,
      metadata: params.metadata,
      parentId: this.parentId
    };
    this.record.spans.push(recorded);
    return {
      id: `span-${this.record.spans.length}`,
      end: (endParams) => {
        recorded.end = endParams;
      },
      span: (childParams) => this.span(childParams),
      generation: (childParams) => this.generation(childParams),
      event: () => undefined
    };
  }

  generation(_params: Parameters<Strategy.Tracer.Tracer['generation']>[0]): Strategy.Tracer.Generation {
    this.record.generations++;
    return { id: `generation-${this.record.generations}`, end: () => undefined };
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
  withoutInterceptorManager?: boolean;
  callTool?: Interface.MCP.MCPManager['callTool'];
  signal?: AbortSignal;
}

async function generate({
  replies,
  additionalTools,
  interceptors,
  withoutInterceptorManager,
  callTool,
  signal
}: Setup) {
  const llm = new ScriptedLLMStrategy(LLM, replies);
  const tracer = new SpyTracer({ spans: [], generations: 0 });

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
    (withoutInterceptorManager ? undefined : toolInterceptorManager) as Interface.ToolInterceptorManager,
    { mcp: { maxCallsPerGenerate: MAX_CALLS } }
  );
  await llmManager.use(LLM, llm, false);

  const ctx = {
    request: { correlatorIds: ['correlator-1'], messages: { augmentedContext: [], directMessages: [] } },
    session: { id: SESSION_ID },
    tracer
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
    signal ? { signal } : undefined
  );
  return { response, llm, spans: tracer.spans, callTool: vi.mocked(mcpManager.callTool) };
}

const toolCall = (callId: string, name: string, args: Record<string, unknown> = {}) => ({
  type: 'tool_call',
  method: 'tools/call',
  callId,
  params: { name, arguments: args }
});

const assistantWith = (...calls: ReturnType<typeof toolCall>[]) => ({
  role: Type.LLM.UnifiedMessageRole.assistant,
  author: 'assistant',
  llmName: LLM,
  manifestName: MANIFEST,
  llmIgnore: false,
  content: calls
});

const toolResultMessage = (name: string, callId: string, text: string, isError: boolean | undefined) => ({
  sessionId: SESSION_ID,
  ctx: {},
  role: Type.LLM.UnifiedMessageRole.tool,
  author: `tool-${name}`,
  llmName: LLM,
  manifestName: MANIFEST,
  llmIgnore: false,
  content: [{ type: 'tool_result', callId, content: [{ type: 'text', text }], isError }]
});

const lookupOrder = (handler: Chat.AdditionalTool['handler']): Chat.AdditionalTool => ({
  definition: {
    name: 'lookup_order',
    description: 'Looks up an order',
    inputSchema: { type: Chat.AdditionalToolSchemaType.OBJECT, properties: { id: { type: 'string' } } }
  },
  handler
});

describe('LlmManager tool execution', () => {
  afterEach(() => {
    Logger.configure();
  });

  it('unsupported tool yields an error tool result first', async () => {
    const { response, llm, spans } = await generate({
      replies: [{ toolCalls: [{ name: 'no_such_tool', callId: 'call-1' }] }, { text: 'Sorry.' }]
    });

    expect(response.usedTools).toMatchObject([
      assistantWith(toolCall('call-1', 'no_such_tool')),
      toolResultMessage(
        'no_such_tool',
        'call-1',
        'Error: Tool "no_such_tool" is not supported by any registered tool source',
        true
      )
    ]);
    expect(spans).toEqual([]);
    expect(llm.calls[1].messages.at(-1)?.toolResults).toEqual([
      {
        callId: 'call-1',
        text: 'Error: Tool "no_such_tool" is not supported by any registered tool source',
        isError: true
      }
    ]);
  });

  it('additional tool success', async () => {
    const handler = vi.fn(async () => ({
      content: [{ type: Chat.AdditionalToolContentType.TEXT as const, text: 'Order 42 shipped' }]
    }));

    const { response, spans, callTool } = await generate({
      replies: [
        { toolCalls: [{ name: 'lookup_order', arguments: { id: '42' }, callId: 'call-1' }] },
        { text: 'Done.' }
      ],
      additionalTools: [lookupOrder(handler)]
    });

    expect(handler).toHaveBeenCalledWith({ id: '42' }, { signal: undefined, emit: expect.any(Function) });
    expect(callTool).not.toHaveBeenCalled();
    expect(response.usedTools).toMatchObject([
      assistantWith(toolCall('call-1', 'lookup_order', { id: '42' })),
      toolResultMessage('lookup_order', 'call-1', 'Order 42 shipped', false)
    ]);
    expect(spans).toEqual([
      {
        name: 'additional-tool-lookup_order',
        input: { name: 'lookup_order', arguments: { id: '42' } },
        metadata: { toolName: 'lookup_order', callId: 'call-1', loopIteration: 1, source: 'additional' },
        parentId: 'generation-1',
        end: {
          output: response.usedTools?.[1],
          metadata: { isError: false, source: 'additional' },
          level: 'DEFAULT'
        }
      }
    ]);
  });

  it('additional tool throw yields Critical execution error', async () => {
    const handler = vi.fn(async (): Promise<Chat.AdditionalToolResult> => {
      throw new Error('Order service down');
    });

    const { response, spans } = await generate({
      replies: [
        { toolCalls: [{ name: 'lookup_order', arguments: { id: '42' }, callId: 'call-1' }] },
        { text: 'Sorry.' }
      ],
      additionalTools: [lookupOrder(handler)]
    });

    expect(response.usedTools).toMatchObject([
      assistantWith(toolCall('call-1', 'lookup_order', { id: '42' })),
      toolResultMessage('lookup_order', 'call-1', 'Critical execution error: Order service down', true)
    ]);
    expect(spans).toEqual([
      {
        name: 'additional-tool-lookup_order',
        input: { name: 'lookup_order', arguments: { id: '42' } },
        metadata: { toolName: 'lookup_order', callId: 'call-1', loopIteration: 1, source: 'additional' },
        parentId: 'generation-1',
        end: {
          output: response.usedTools?.[1],
          metadata: { isError: true, source: 'additional' },
          level: 'ERROR',
          statusMessage: 'Order service down'
        }
      }
    ]);
  });

  it('additional tool receives the generate signal', async () => {
    const controller = new AbortController();
    const handler = vi.fn(async (_args: Record<string, unknown>, _context?: Chat.AdditionalToolContext) => ({
      content: [{ type: Chat.AdditionalToolContentType.TEXT as const, text: 'Order 42 shipped' }]
    }));

    await generate({
      replies: [
        { toolCalls: [{ name: 'lookup_order', arguments: { id: '42' }, callId: 'call-1' }] },
        { text: 'Done.' }
      ],
      additionalTools: [lookupOrder(handler)],
      signal: controller.signal
    });

    const context = handler.mock.calls[0][1];
    expect(context?.signal).toBe(controller.signal);
    expect(() => context?.emit('progress', { done: 1 })).not.toThrow();
    expect(context?.emit('progress', { done: 1 })).toBeUndefined();
  });

  it('mcp callTool receives the signal', async () => {
    const controller = new AbortController();

    const { callTool } = await generate({
      replies: [
        { toolCalls: [{ name: 'get_weather', arguments: { city: 'Kyiv' }, callId: 'call-1' }] },
        { text: 'Cloudy.' }
      ],
      withoutInterceptorManager: true,
      signal: controller.signal
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(Object.keys(callTool.mock.calls[0][2] ?? {})).toEqual(['signal']);
    // A signal of the request's own, which aborts with the caller's
    const signal = callTool.mock.calls[0][2]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal).not.toBe(controller.signal);
    const reason = new Error('client went away');
    controller.abort(reason);
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toBe(reason);
  });

  it('mcp calls leave no abort listener on a long-lived signal', async () => {
    // An app-wide signal passed to every generate() call
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, 'addEventListener');
    // Like the MCP SDK, the server adds an abort listener to the request's signal and never removes it
    const callTool: Interface.MCP.MCPManager['callTool'] = async (_params, _schema, options) => {
      options?.signal?.addEventListener('abort', () => undefined);
      return { content: [{ type: 'text', text: '18°C, cloudy' }], isError: false };
    };
    const getWeather = { toolCalls: [{ name: 'get_weather', arguments: { city: 'Kyiv' }, callId: 'call-1' }] };
    const viaInterceptor: Interface.ToolInterceptor = async ({ toolRequest, executeToolFn }) =>
      executeToolFn({ params: toolRequest.params });

    for (let i = 0; i < 10; i++) {
      await generate({
        replies: [getWeather, { text: 'Cloudy.' }],
        withoutInterceptorManager: true,
        callTool,
        signal: controller.signal
      });
      await generate({
        replies: [getWeather, { text: 'Cloudy.' }],
        interceptors: { get_weather: viaInterceptor },
        callTool,
        signal: controller.signal
      });
    }

    expect(addListener).not.toHaveBeenCalled();
  });

  it('interceptor executeToolFn passes the signal', async () => {
    const controller = new AbortController();
    const interceptor: Interface.ToolInterceptor = async ({ toolRequest, executeToolFn }) =>
      executeToolFn({ params: toolRequest.params, clientNames: ['weather-server'] });

    const { callTool } = await generate({
      replies: [
        { toolCalls: [{ name: 'get_weather', arguments: { city: 'Kyiv' }, callId: 'call-1' }] },
        { text: 'Cloudy.' }
      ],
      interceptors: { get_weather: interceptor },
      signal: controller.signal
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    const signal = callTool.mock.calls[0][2]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal).not.toBe(controller.signal);
    controller.abort();
    expect(signal?.aborted).toBe(true);
    expect(callTool.mock.calls[0][3]).toEqual(['weather-server']);
  });

  it('tool params are not logged', async () => {
    const sentinel = 'SENTINEL-secret-4711';
    const loggerStrategy = configureMockLoggerStrategy(Interface.LogLevel.TRACE);

    await generate({
      replies: [
        { toolCalls: [{ name: 'get_weather', arguments: { city: sentinel }, callId: 'call-1' }] },
        { toolCalls: [{ name: 'lookup_order', arguments: { id: sentinel }, callId: 'call-2' }] },
        { text: 'Done.' }
      ],
      additionalTools: [
        lookupOrder(async () => ({
          content: [{ type: Chat.AdditionalToolContentType.TEXT as const, text: 'Order shipped' }]
        }))
      ]
    });

    const executing = vi
      .mocked(loggerStrategy.debug)
      .mock.calls.filter(([message]) => String(message).startsWith('Executing tool'));
    expect(executing).toHaveLength(2);
    for (const [, , meta] of executing) {
      expect(Object.keys(meta).sort()).toEqual(['callId', 'chainLength', 'loopCount', 'source', 'toolName']);
    }
    const everyLoggedCall = Object.values(loggerStrategy).flatMap(
      (strategyMethod) => vi.mocked(strategyMethod).mock.calls
    );
    expect(everyLoggedCall.length).toBeGreaterThan(0);
    expect(JSON.stringify(everyLoggedCall)).not.toContain(sentinel);
  });

  it('mcp tool via interceptor', async () => {
    const interceptor = vi.fn<Interface.ToolInterceptor>(async ({ toolRequest, executeToolFn }) =>
      executeToolFn({ params: toolRequest.params, clientNames: ['weather-server'] })
    );

    const { response, spans, callTool } = await generate({
      replies: [
        { toolCalls: [{ name: 'get_weather', arguments: { city: 'Kyiv' }, callId: 'call-1' }] },
        { text: 'Cloudy.' }
      ],
      interceptors: { get_weather: interceptor }
    });

    const params = interceptor.mock.calls[0][0];
    expect(params.toolRequest).toMatchObject(toolCall('call-1', 'get_weather', { city: 'Kyiv' }));
    expect(params.calledTool).toBe(mcpTools[0]);
    expect(params.toolChain).toBe(response.usedTools);
    expect(params.callLimits).toEqual({ current: 1, max: MAX_CALLS });
    expect(params.toolClients).toEqual([{ clientName: 'weather-server', metadata: { transportType: 'memory' } }]);
    expect(callTool.mock.calls).toStrictEqual([
      [{ name: 'get_weather', arguments: { city: 'Kyiv' } }, undefined, { signal: undefined }, ['weather-server']]
    ]);

    expect(response.usedTools).toMatchObject([
      assistantWith(toolCall('call-1', 'get_weather', { city: 'Kyiv' })),
      toolResultMessage('get_weather', 'call-1', '18°C, cloudy', false)
    ]);
    expect(spans).toEqual([
      {
        name: 'mcp-tool-get_weather',
        input: { name: 'get_weather', arguments: { city: 'Kyiv' } },
        metadata: { toolName: 'get_weather', callId: 'call-1', loopIteration: 1 },
        parentId: 'generation-1',
        end: {
          output: response.usedTools?.[1],
          metadata: { isError: false, contentLength: 1, hasContent: true },
          level: 'DEFAULT'
        }
      }
    ]);
  });

  it('mcp tool without a tool interceptor manager is called directly', async () => {
    const { response, spans, callTool } = await generate({
      replies: [
        { toolCalls: [{ name: 'get_weather', arguments: { city: 'Kyiv' }, callId: 'call-1' }] },
        { text: 'Cloudy.' }
      ],
      withoutInterceptorManager: true,
      callTool: async () => ({ content: [{ type: 'text', text: 'No data for Kyiv' }], isError: true })
    });

    expect(callTool.mock.calls).toStrictEqual([
      [{ name: 'get_weather', arguments: { city: 'Kyiv' } }, undefined, { signal: undefined }]
    ]);
    expect(response.usedTools).toMatchObject([
      assistantWith(toolCall('call-1', 'get_weather', { city: 'Kyiv' })),
      toolResultMessage('get_weather', 'call-1', 'No data for Kyiv', true)
    ]);
    expect(spans).toEqual([
      {
        name: 'mcp-tool-get_weather',
        input: { name: 'get_weather', arguments: { city: 'Kyiv' } },
        metadata: { toolName: 'get_weather', callId: 'call-1', loopIteration: 1 },
        parentId: 'generation-1',
        end: {
          output: response.usedTools?.[1],
          metadata: { isError: true, contentLength: 1, hasContent: true },
          level: 'WARNING'
        }
      }
    ]);
  });

  it('mcp tool throw yields Critical execution error', async () => {
    const { response, spans } = await generate({
      replies: [
        { toolCalls: [{ name: 'get_weather', arguments: { city: 'Kyiv' }, callId: 'call-1' }] },
        { text: 'Sorry.' }
      ],
      callTool: async () => {
        throw new Error('Weather service down');
      }
    });

    expect(response.usedTools).toMatchObject([
      assistantWith(toolCall('call-1', 'get_weather', { city: 'Kyiv' })),
      toolResultMessage('get_weather', 'call-1', 'Critical execution error: Weather service down', true)
    ]);
    expect(spans).toEqual([
      {
        name: 'mcp-tool-get_weather',
        input: { name: 'get_weather', arguments: { city: 'Kyiv' } },
        metadata: { toolName: 'get_weather', callId: 'call-1', loopIteration: 1 },
        parentId: 'generation-1',
        end: {
          output: response.usedTools?.[1],
          metadata: { isError: true, errorMessage: 'Weather service down' },
          level: 'ERROR',
          statusMessage: 'Weather service down'
        }
      }
    ]);
  });

  it('interceptor preventGenerate overrides the response', async () => {
    const interceptor: Interface.ToolInterceptor = async ({ toolRequest, executeToolFn, preventGenerate }) => {
      preventGenerate({
        content: [{ type: 'text', text: 'Here is the weather card.' }],
        role: Type.LLM.UnifiedMessageRole.assistant
      });
      return executeToolFn({ params: toolRequest.params });
    };

    const { response, llm, spans, callTool } = await generate({
      // A single reply: the override replaces the follow-up LLM call
      replies: [
        {
          toolCalls: [
            { name: 'get_weather', arguments: { city: 'Kyiv' }, callId: 'call-1' },
            { name: 'ping', callId: 'call-2' }
          ]
        }
      ],
      interceptors: { get_weather: interceptor }
    });

    expect(llm.calls).toHaveLength(1);
    // The tool calls after the overriding one do not run
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(response.topChoice).toMatchObject({
      content: [{ type: 'text', text: 'Here is the weather card.' }],
      role: Type.LLM.UnifiedMessageRole.assistant,
      author: 'tool_interceptor',
      llmName: LLM,
      manifestName: MANIFEST,
      sessionId: SESSION_ID,
      llmIgnore: false
    });
    expect(response.choices).toEqual([response.topChoice]);
    expect(response.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      model: 'tool-interceptor',
      finishReason: 'interceptor_override'
    });
    expect(response.originalResponse).toEqual({ generatedByToolInterceptor: true });
    expect(response.usedTools).toMatchObject([
      assistantWith(toolCall('call-1', 'get_weather', { city: 'Kyiv' }), toolCall('call-2', 'ping')),
      toolResultMessage('get_weather', 'call-1', '18°C, cloudy', false)
    ]);
    expect(spans).toEqual([
      {
        name: 'mcp-tool-get_weather',
        input: { name: 'get_weather', arguments: { city: 'Kyiv' } },
        metadata: { toolName: 'get_weather', callId: 'call-1', loopIteration: 1 },
        parentId: 'generation-1',
        end: {
          output: response.usedTools?.[1],
          metadata: { isError: false, contentLength: 1, hasContent: true },
          level: 'DEFAULT'
        }
      }
    ]);
  });

  it("mixed: unsupported, additional, mcp in today's order", async () => {
    const handler = vi.fn(async () => ({
      content: [{ type: Chat.AdditionalToolContentType.TEXT as const, text: 'Order 42 shipped' }],
      isError: true
    }));

    const { response, llm, spans } = await generate({
      replies: [
        {
          toolCalls: [
            { name: 'get_weather', arguments: { city: 'Kyiv' }, callId: 'call-1' },
            { name: 'no_such_tool', callId: 'call-2' },
            { name: 'lookup_order', arguments: { id: '42' }, callId: 'call-3' }
          ]
        },
        { toolCalls: [{ name: 'ping', callId: 'call-4' }] },
        { text: 'Done.' }
      ],
      additionalTools: [lookupOrder(handler)]
    });

    expect(response.usedTools).toMatchObject([
      assistantWith(
        toolCall('call-1', 'get_weather', { city: 'Kyiv' }),
        toolCall('call-2', 'no_such_tool'),
        toolCall('call-3', 'lookup_order', { id: '42' })
      ),
      toolResultMessage(
        'no_such_tool',
        'call-2',
        'Error: Tool "no_such_tool" is not supported by any registered tool source',
        true
      ),
      toolResultMessage('lookup_order', 'call-3', 'Order 42 shipped', true),
      toolResultMessage('get_weather', 'call-1', '18°C, cloudy', false),
      assistantWith(toolCall('call-4', 'ping')),
      toolResultMessage('ping', 'call-4', '18°C, cloudy', false)
    ]);
    expect(llm.calls[1].messages.slice(-3).map((message) => message.toolResults[0].callId)).toEqual([
      'call-2',
      'call-3',
      'call-1'
    ]);
    expect(spans).toEqual([
      {
        name: 'additional-tool-lookup_order',
        input: { name: 'lookup_order', arguments: { id: '42' } },
        metadata: { toolName: 'lookup_order', callId: 'call-3', loopIteration: 1, source: 'additional' },
        parentId: 'generation-1',
        end: {
          output: response.usedTools?.[2],
          metadata: { isError: true, source: 'additional' },
          level: 'WARNING'
        }
      },
      {
        name: 'mcp-tool-get_weather',
        input: { name: 'get_weather', arguments: { city: 'Kyiv' } },
        metadata: { toolName: 'get_weather', callId: 'call-1', loopIteration: 1 },
        parentId: 'generation-1',
        end: {
          output: response.usedTools?.[3],
          metadata: { isError: false, contentLength: 1, hasContent: true },
          level: 'DEFAULT'
        }
      },
      {
        name: 'mcp-tool-ping',
        input: { name: 'ping', arguments: {} },
        metadata: { toolName: 'ping', callId: 'call-4', loopIteration: 2 },
        parentId: 'generation-2',
        end: {
          output: response.usedTools?.[5],
          metadata: { isError: false, contentLength: 1, hasContent: true },
          level: 'DEFAULT'
        }
      }
    ]);
  });
});
