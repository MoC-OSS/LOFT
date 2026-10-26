import type {
  BeforeGenerateMiddleware,
  Chat,
  ContextInterface,
  GenerateRequestParameters,
  StandardMiddleware,
  Type
} from '@moc-global/loft-definitions';

/** The parts of a tool's output, as LOFT stores them in a tool result. */
export type ToolOutputPart = Type.Entity.ToolResultContent['content'][number];

/** A tool's output before the model sees it. */
export interface ToolOutput {
  content: ToolOutputPart[];
  isError: boolean;
}

/** Which tool produced an output. */
export interface ToolInfo {
  toolName: string;
  /** `mcp` for a tool of an MCP client, `additional` for a tool passed to `generate({ additionalTools })` */
  source: 'mcp' | 'additional';
  /** The `serverName` given to `guardMcpClient`, for a tool of an MCP client */
  serverName?: string;
}

/** A tool an MCP server lists, with the texts the model reads. */
export interface ListedTool {
  name: string;
  title?: string;
  description?: string;
  annotations?: unknown;
  inputSchema?: unknown;
}

/**
 * A middleware with hooks for each place data passes. It is plain data: `applyMiddleware` registers the chat hooks,
 * `guardMcpClient`, `guardTool` and `guardTools` apply `toolResult` and `toolList`, and `maskTracerFactory` and
 * `maskTracer` apply `maskTrace`. Give the same array of middleware to each of them.
 */
export interface LoftMiddleware {
  /** Unique per chat: the chat hooks are registered under this name. */
  readonly name: string;
  /** Runs on `addMessages()` and on `generate()`, so it must be safe to apply twice. */
  readonly input?: StandardMiddleware<ContextInterface, GenerateRequestParameters>;
  readonly beforeGenerate?: BeforeGenerateMiddleware<ContextInterface, GenerateRequestParameters>;
  readonly afterGenerate?: StandardMiddleware<ContextInterface, Chat.GenerateResultMessages>;
  /**
   * Whether `afterGenerate` may change the reply text. Default true, which holds streamed text back until it has run;
   * see the `transformsOutput` option of `registerAfterGenerateMiddleware`.
   */
  readonly afterGenerateTransformsOutput?: boolean;
  /** Inspects or rewrites a tool's output before the model sees it. A throw withholds the output. */
  readonly toolResult?: (output: ToolOutput, tool: ToolInfo) => ToolOutput | Promise<ToolOutput>;
  /** Filters the tools an MCP server lists, before the model sees their descriptions. */
  readonly toolList?: <T extends ListedTool>(tools: T[]) => T[] | Promise<T[]>;
  /** Rewrites a string before it is sent to the tracer. Must be synchronous, as tracer calls are. */
  readonly maskTrace?: (text: string) => string;
}
