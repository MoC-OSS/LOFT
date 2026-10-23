import { Chat, Logger } from '@moc-global/loft-definitions';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { errorMessage, textOfParts } from './content';
import type { ListedTool, LoftMiddleware, ToolInfo, ToolOutput, ToolOutputPart } from './types';

const log = new Logger('LoftMiddleware');

/** What the model receives when a middleware fails on a tool's output: the output is withheld. */
export const TOOL_GUARD_FAILED_TEXT = '[tool output withheld: a guard could not check it]';

/**
 * Runs the middleware's `toolResult` hooks in order. A hook that throws withholds the output: the model gets a fixed
 * error text and nothing of the output.
 */
export async function guardToolOutput(
  middleware: readonly LoftMiddleware[],
  output: ToolOutput,
  tool: ToolInfo
): Promise<ToolOutput> {
  let current = output;
  for (const item of middleware) {
    if (!item.toolResult) continue;
    try {
      current = await item.toolResult(current, tool);
    } catch (error) {
      log.warn('A tool output was withheld because a middleware failed on it', {
        middleware: item.name,
        toolName: tool.toolName,
        errorName: error instanceof Error ? error.name : typeof error
      });
      return { content: [{ type: 'text', text: TOOL_GUARD_FAILED_TEXT }], isError: true };
    }
  }
  return current;
}

// Runs the middleware's toolList hooks in order. A hook that throws leaves every tool of the server out
async function guardToolList<T extends ListedTool>(middleware: readonly LoftMiddleware[], tools: T[]): Promise<T[]> {
  let current = tools;
  for (const item of middleware) {
    if (!item.toolList) continue;
    try {
      current = await item.toolList(current);
    } catch (error) {
      log.warn('The tools of an MCP server were left out because a middleware failed on them', {
        middleware: item.name,
        errorName: error instanceof Error ? error.name : typeof error
      });
      return [];
    }
  }
  if (tools.length > 0 && current.length === 0) log.warn('Middleware left out every tool of an MCP server');
  return current;
}

// The message of a failed tool reaches the model, the logs and the trace; the error is replaced by one that carries
// only the guarded message, so the original text does not travel along as its cause
async function guardedError(middleware: readonly LoftMiddleware[], error: unknown, tool: ToolInfo): Promise<Error> {
  const guarded = await guardToolOutput(
    middleware,
    { content: [{ type: 'text', text: errorMessage(error) }], isError: true },
    tool
  );
  return new Error(textOfParts(guarded.content));
}

function toAdditionalContent(parts: readonly ToolOutputPart[]): Chat.AdditionalToolResult['content'] {
  return parts.flatMap((part) =>
    part.type === 'text' ? [{ type: Chat.AdditionalToolContentType.TEXT, text: part.text }] : []
  );
}

/**
 * An additional tool whose output, and the message of the error it throws, pass the middleware's `toolResult` hooks
 * before the model sees them. Wrap each tool you pass to `generate({ additionalTools })`, or use `guardTools`.
 * The `data` events the tool emits through `context.emit` are the tool's own and pass unchanged.
 */
export function guardTool(tool: Chat.AdditionalTool, middleware: readonly LoftMiddleware[]): Chat.AdditionalTool {
  const hooks = middleware.filter((item) => item.toolResult);
  if (hooks.length === 0) return tool;
  const info: ToolInfo = { toolName: tool.definition.name, source: 'additional' };
  return {
    ...tool,
    handler: async (args, context) => {
      let result: Chat.AdditionalToolResult;
      try {
        result = await tool.handler(args, context);
      } catch (error) {
        throw await guardedError(hooks, error, info);
      }
      const guarded = await guardToolOutput(hooks, { content: result.content, isError: result.isError ?? false }, info);
      return { content: toAdditionalContent(guarded.content), isError: guarded.isError };
    }
  };
}

/** `guardTool` for each tool. */
export function guardTools(
  tools: readonly Chat.AdditionalTool[],
  middleware: readonly LoftMiddleware[]
): Chat.AdditionalTool[] {
  return tools.map((tool) => guardTool(tool, middleware));
}

export interface GuardMcpClientOptions {
  /** Passed to the hooks as `ToolInfo.serverName`, such as the name given to `useMcpClient` */
  serverName?: string;
}

/**
 * An MCP client whose tool results, and the messages of failed calls, pass the middleware's `toolResult` hooks, and
 * whose tool list passes their `toolList` hooks, before the model sees them. Pass it to `useMcpClient` in place of
 * the client it wraps. Every other method is the client's own.
 */
export function guardMcpClient(
  client: Client,
  middleware: readonly LoftMiddleware[],
  options: GuardMcpClientOptions = {}
): Client {
  const resultHooks = middleware.filter((item) => item.toolResult);
  const listHooks = middleware.filter((item) => item.toolList);
  if (resultHooks.length === 0 && listHooks.length === 0) return client;

  const callTool: Client['callTool'] = async (...args) => {
    const info: ToolInfo = {
      toolName: args[0].name,
      source: 'mcp',
      ...(options.serverName !== undefined && { serverName: options.serverName })
    };
    let result: Awaited<ReturnType<Client['callTool']>>;
    try {
      result = await client.callTool(...args);
    } catch (error) {
      throw await guardedError(resultHooks, error, info);
    }
    // An older server's result carries `toolResult` instead of content. LOFT reads only content, so it treats such a
    // result as empty; the guard drops the rest, which the hooks cannot check
    if (!Array.isArray(result.content)) {
      log.warn('An MCP tool output without a content list was dropped', { toolName: info.toolName });
      return { content: [], isError: result.isError === true };
    }
    const content = result.content as ToolOutputPart[];
    const guarded = await guardToolOutput(resultHooks, { content, isError: result.isError === true }, info);
    // The structured copy of an output a guard changed would keep what the guard took out
    const changed = JSON.stringify(guarded.content) !== JSON.stringify(content);
    const { structuredContent, ...rest } = result;
    return {
      ...(changed ? rest : { ...rest, structuredContent }),
      content: guarded.content,
      isError: guarded.isError
    };
  };

  const listTools: Client['listTools'] = async (...args) => {
    const result = await client.listTools(...args);
    return { ...result, tools: await guardToolList(listHooks, result.tools) };
  };

  return new Proxy(client, {
    get(target, property) {
      if (property === 'callTool' && resultHooks.length > 0) return callTool;
      if (property === 'listTools' && listHooks.length > 0) return listTools;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}
