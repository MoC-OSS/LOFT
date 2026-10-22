import { inspect } from 'node:util';

import {
  Chat,
  ContextInterface,
  InteractiveOutputMessage,
  Interface,
  Logger,
  OverrideGeneratePayload,
  Strategy,
  Type
} from '@moc-global/loft-definitions';

import { UsedToolMessage } from '../utils/toolValidation';

type McpTool = Awaited<ReturnType<Interface.MCP.MCPManager['listTools']>>[number];

/** What running one tool call produced. `override` means a tool interceptor replaced the LLM's next reply. */
export type ToolOutcome =
  | { kind: 'result'; message: UsedToolMessage; isError: boolean }
  | { kind: 'override'; message: UsedToolMessage; isError: boolean; override: OverrideGeneratePayload };

export interface ToolExecutionInput {
  ctx: ContextInterface;
  request: Type.Entity.ToolCallContent;
  /** Where the tool comes from, as the logs report it */
  source: 'additional' | 'mcp';
  /** The additional tool's handler; without it the call goes to MCP */
  handler?: Chat.AdditionalTool['handler'];
  /** The MCP tool the call names, which the tool interceptor receives */
  calledTool?: McpTool;
  /** The tool calls and results of this generate() call; the result is appended to it */
  toolChain: UsedToolMessage[];
  /** The LLM call count and its limit, passed to the tool interceptor */
  loop: { current: number; max: number };
  tracer: Strategy.Tracer.Tracer;
  /** The LLM generation the tool span belongs to */
  parentGenerationId: string;
  llmName: string;
  manifestName: string;
  /** Cancels the tool call; handed to the additional tool's handler and to MCP requests */
  signal?: AbortSignal;
  /** The additional tool's emit, which sends a `data` event to a streaming caller */
  emit?: Chat.AdditionalToolContext['emit'];
}

export interface ToolExecutionDeps {
  mcpManager: Interface.MCP.MCPManager;
  toolInterceptorManager?: Interface.ToolInterceptorManager;
  log: Logger;
}

// Without a streaming caller a tool handler's emit does nothing
const noop = (): void => undefined;

type ToolMessageInput = Pick<ToolExecutionInput, 'ctx' | 'request' | 'llmName' | 'manifestName'>;

/**
 * Runs one tool call: an additional tool through its handler, any other tool through MCP (and the tool interceptor,
 * when there is one). Appends the tool result to the tool chain and traces the call as a span. A tool that throws
 * becomes an error result, so every tool call gets a result.
 */
export async function executeTool(input: ToolExecutionInput, deps: ToolExecutionDeps): Promise<ToolOutcome> {
  const { request, handler } = input;
  deps.log.debug(`Executing tool: "${request.params.name}" with callId: ${request.callId}`, {
    toolName: request.params.name,
    callId: request.callId,
    loopCount: input.loop.current,
    chainLength: input.toolChain.length,
    source: input.source
  });

  return handler ? executeAdditionalTool(input, handler, deps.log) : executeMcpTool(input, deps);
}

/** The error result for a tool call that no tool source supports. */
export function unsupportedToolResult(input: ToolMessageInput): UsedToolMessage {
  return toolMessage(input, {
    type: 'tool_result',
    callId: input.request.callId,
    content: [
      {
        type: 'text' as const,
        text: `Error: Tool "${input.request.params.name}" is not supported by any registered tool source`
      }
    ],
    isError: true
  });
}

async function executeAdditionalTool(
  input: ToolExecutionInput,
  handler: Chat.AdditionalTool['handler'],
  log: Logger
): Promise<ToolOutcome> {
  const { request, toolChain, loop } = input;
  const toolName = request.params.name;
  const toolSpan = input.tracer.withParent(input.parentGenerationId).span({
    name: `additional-tool-${toolName}`,
    input: request.params,
    metadata: {
      toolName,
      callId: request.callId,
      loopIteration: loop.current,
      source: 'additional'
    }
  });

  try {
    const context: Chat.AdditionalToolContext = { signal: input.signal, emit: input.emit ?? noop };
    const result = await handler(request.params.arguments ?? {}, context);

    const toolResult = toolMessage(input, {
      type: 'tool_result',
      callId: request.callId,
      content: result.content as Type.Entity.ToolResultContent['content'],
      isError: result.isError ?? false
    });

    toolChain.push(toolResult);
    log.debug(`Added additional tool result to chain`, {
      toolName,
      callId: request.callId,
      chainLength: toolChain.length,
      isError: result.isError,
      loopCount: loop.current
    });

    toolSpan.end({
      output: toolResult,
      metadata: { isError: result.isError ?? false, source: 'additional' },
      level: result.isError ? 'WARNING' : 'DEFAULT'
    });
    return { kind: 'result', message: toolResult, isError: result.isError ?? false };
  } catch (error) {
    log.error(`Critical error during additional tool execution: "${toolName}"`, {
      toolName,
      callId: request.callId,
      error: errorText(error),
      loopCount: loop.current
    });

    const errorToolResult = toolMessage(input, criticalErrorContent(request, error));
    toolChain.push(errorToolResult);

    toolSpan.end({
      output: errorToolResult,
      metadata: { isError: true, source: 'additional' },
      level: 'ERROR',
      statusMessage: errorText(error)
    });
    return { kind: 'result', message: errorToolResult, isError: true };
  }
}

// The MCP SDK adds an abort listener to a request's signal and never removes it, so on a long-lived signal one would
// pile up per tool call. Each request gets a signal of its own that aborts with the caller's, and the listener goes
// away with it.
const mcpRequestOptions = (signal: AbortSignal | undefined) => ({ signal: signal && AbortSignal.any([signal]) });

async function executeMcpTool(input: ToolExecutionInput, deps: ToolExecutionDeps): Promise<ToolOutcome> {
  const { ctx, request, calledTool, toolChain, loop, signal } = input;
  const { mcpManager, toolInterceptorManager, log } = deps;
  const toolName = request.params.name;
  const toolSpan = input.tracer.withParent(input.parentGenerationId).span({
    name: `mcp-tool-${toolName}`,
    input: request.params,
    metadata: {
      toolName,
      callId: request.callId,
      loopIteration: loop.current
    }
  });

  try {
    // Get MCP clients with metadata that support this tool
    const toolClientsMap = await mcpManager.getClientsInfoForTool(toolName);

    // Convert Map to Array for toolInterceptor callback
    const toolClients = Array.from(toolClientsMap.entries()).map(([clientName, metadata]) => ({
      clientName,
      metadata
    }));

    // Set when the interceptor calls preventGenerate; the last call wins
    const prevented: { payload?: OverrideGeneratePayload } = {};

    const toolResponse =
      toolInterceptorManager && calledTool
        ? await toolInterceptorManager.handle({
            ctx,
            toolRequest: request,
            calledTool,
            toolChain,
            executeToolFn: ({ params, clientNames }) =>
              mcpManager.callTool(params, undefined, mcpRequestOptions(signal), clientNames),
            callLimits: {
              current: loop.current,
              max: loop.max
            },
            toolClients,
            preventGenerate: (payload: OverrideGeneratePayload) => {
              prevented.payload = payload;
            }
          })
        : await mcpManager.callTool(request.params, undefined, mcpRequestOptions(signal));

    log.debug(`Tool "${toolName}" execution completed`, {
      toolName,
      callId: request.callId,
      isError: toolResponse.isError,
      contentLength: toolResponse.content?.length || 0,
      hasError: !!toolResponse.error
    });

    const unifiedToolContent: Type.Entity.ToolResultContent = {
      type: 'tool_result',
      callId: request.callId,
      content: toolResponse.content,
      isError: toolResponse.isError
    };

    // If there's an error and no content provided, add a text content item explaining the error
    if (toolResponse.isError && (!toolResponse.content || toolResponse.content.length === 0)) {
      const errorMessage = describeToolError(toolResponse.error);
      unifiedToolContent.content = [
        {
          type: 'text',
          text: `Error: ${errorMessage}`
        }
      ];
      log.warn(`Tool "${toolName}" execution failed`, {
        toolName,
        callId: request.callId,
        error: errorMessage,
        loopCount: loop.current
      });
    }

    const toolResult = toolMessage(input, unifiedToolContent);
    toolChain.push(toolResult);
    log.debug(`Added tool result to the tools chain`, {
      toolName,
      callId: request.callId,
      chainLength: toolChain.length,
      isError: toolResponse.isError,
      loopCount: loop.current
    });

    toolSpan.end({
      output: toolResult,
      metadata: {
        isError: toolResponse.isError,
        contentLength: toolResponse.content?.length || 0,
        hasContent: !!toolResponse.content
      },
      level: toolResponse.isError ? 'WARNING' : 'DEFAULT'
    });

    if (prevented.payload) {
      return {
        kind: 'override',
        message: toolResult,
        isError: toolResponse.isError ?? false,
        override: prevented.payload
      };
    }
    return { kind: 'result', message: toolResult, isError: toolResponse.isError ?? false };
  } catch (error) {
    log.error(`Critical error during tool execution: "${toolName}"`, {
      toolName,
      callId: request.callId,
      error: errorText(error),
      stack: error instanceof Error ? error.stack : undefined,
      loopCount: loop.current,
      chainLength: toolChain.length
    });

    // An error result keeps every tool call answered
    const errorToolResult = toolMessage(input, criticalErrorContent(request, error));
    toolChain.push(errorToolResult);
    log.debug(`Added error tool result after critical failure`, {
      toolName,
      callId: request.callId,
      chainLength: toolChain.length,
      loopCount: loop.current
    });

    toolSpan.end({
      output: errorToolResult,
      metadata: {
        isError: true,
        errorMessage: errorText(error)
      },
      level: 'ERROR',
      statusMessage: errorText(error)
    });
    return { kind: 'result', message: errorToolResult, isError: true };
  }
}

function toolMessage(input: ToolMessageInput, toolContent: Type.Entity.ToolResultContent): UsedToolMessage {
  // The role is always tool, which the message class does not express in its type
  return new InteractiveOutputMessage({
    sessionId: input.ctx.session.id,
    ctx: {},
    content: [toolContent],
    role: Type.LLM.UnifiedMessageRole.tool,
    author: `tool-${input.request.params.name}`,
    llmName: input.llmName,
    manifestName: input.manifestName,
    llmIgnore: false
  }) as UsedToolMessage;
}

function criticalErrorContent(request: Type.Entity.ToolCallContent, error: unknown): Type.Entity.ToolResultContent {
  return {
    type: 'tool_result',
    callId: request.callId,
    content: [
      {
        type: 'text',
        text: `Critical execution error: ${errorText(error)}`
      }
    ],
    isError: true
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A tool interceptor or MCP server may report the error as any value, not only a string
function describeToolError(error: unknown): string {
  if (typeof error === 'string' && error.length > 0) return error;
  if (error instanceof Error) return error.message;
  if (error === undefined || error === null || error === '') return 'Unknown error occurred while executing the tool';
  try {
    return JSON.stringify(error);
  } catch {
    // JSON.stringify fails on circular values; inspect still describes them
    return inspect(error, { depth: 2 });
  }
}
