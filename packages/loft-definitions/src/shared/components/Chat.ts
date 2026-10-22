import {
  Agent,
  Chat,
  ContextInterface,
  Interface,
  Repository,
  RequestContext,
  SMGProcessor,
  Strategy,
  Type,
  Util
} from '../..';
import type { ChatStreamEvent, StreamOptions } from './ChatStreamEvent';

export * from './ChatStreamEvent';

export enum Status {
  ERROR = 'ERROR',
  LOCKED = 'LOCKED',
  SUCCESS = 'SUCCESS',
  /**
   * @deprecated Use chat.generate({ onEvent }) instead.
   * Removed in the next major release.
   */
  SUCCESS_STREAM = 'SUCCESS_STREAM',
  ALREADY_PREPROCESSED = 'ALREADY_PREPROCESSED',
  ALREADY_GENERATED = 'ALREADY_GENERATED',
  SHUTDOWN = 'SHUTDOWN'
}

export interface ChatInputPayload {
  messages: {
    content: Type.Entity.Message['content'];
    role: Type.LLM.UnifiedMessageRole;
    author: string;
    ctx?: Type.Entity.ContextRecord;
  }[];
}

/** @experimental Part of the Queued execution mode, which is not implemented yet. May change or be removed in any release. */
export type SMGActionResult =
  | SMGProcessor.SMGMessageActionReturn['CHAT_APPEND']
  | SMGProcessor.SMGMessageActionReturn['MESSAGE_ARCHIVE']
  | SMGProcessor.SMGMessageActionReturn['SESSION_UPDATE'];

/** @experimental Part of the Queued execution mode, which is not implemented yet. May change or be removed in any release. */
export interface AppendMessagesResult {
  ctx: ContextInterface;
  sessionId: string;
  correlatorIds: string[];
  messageIds: string[];
  status: Status;
}

/** @experimental Part of the Queued execution mode, which is not implemented yet. May change or be removed in any release. */
export interface ProcessSessionActionsResult {
  ctx: ContextInterface;
  sessionId: string;
  correlatorIds: string[];
  messageIds: string[];
  messagesActionStatus: SMGActionResult[];
  status: Status;
  messagesBeforeAction: Type.SMG.Message[];
}

/** @experimental Part of the Queued execution mode, which is not implemented yet. May change or be removed in any release. */
export interface GetPendingMessagesResult {
  sessionId: Type.Entity.Session['id'];
  ctx?: ContextInterface;
  messageIds: RequestContext['messageIds'];
  correlatorIds: RequestContext['correlatorIds'];
  status: Status;
  messages: Type.SMG.Message[];
}

export enum AdditionalToolContentType {
  TEXT = 'text'
}

export enum AdditionalToolSchemaType {
  OBJECT = 'object'
}

export interface AdditionalToolResult {
  content: Array<{ type: AdditionalToolContentType.TEXT; text: string }>;
  isError?: boolean;
}

/** What LOFT hands a tool handler besides the arguments. */
export interface AdditionalToolContext {
  /** Aborted when the caller cancels the `generate()` call that runs the tool */
  signal?: AbortSignal;
  /**
   * @experimental Sends a `data` event to a caller that subscribed to generation events. LOFT adds the step, the tool
   * call id and the tool name. A no-op when the caller passed no `onEvent`, once the tool has finished, and after the
   * call has ended.
   */
  emit(name: string, data: unknown): void;
}

export interface AdditionalTool {
  definition: {
    name: string;
    description: string;
    inputSchema: {
      type: AdditionalToolSchemaType.OBJECT;
      properties?: Record<string, object>;
      required?: string[];
      [key: string]: unknown;
    };
  };
  handler(args: Record<string, unknown>, context?: AdditionalToolContext): Promise<AdditionalToolResult>;
}

export interface GenerateOptions {
  sessionId: Type.Entity.Session['id'];
  ctx?: ContextInterface;
  directMessages?: /*  Type.SMG.Message[] | */ Type.Entity.CreateMessage[];
  augmentedContext?: /* Type.SMG.Message[] | */ Type.Entity.CreateMessage[];
  correlatorIds?: string[];
  temporaryLlmName?: string;
  temporaryManifestName?: string;
  llmContextWindow?: number; // number of chatHistory messages to keep in the context window
  additionalTools?: AdditionalTool[];
  focusAgent?: string | null; // name of registered Focus config, null to disable session-level Focus for this call
  /** Cancels the in-flight LLM request and stops the tool loop; generate() then rejects. */
  signal?: AbortSignal;
  /**
   * @experimental Receives this call's events. Synchronous: a promise it returns is not awaited, and its rejection is
   * contained and logged like an exception it throws, with the event type only.
   */
  onEvent?: (event: ChatStreamEvent) => void;
  /** @experimental Per-call override of the library's streaming defaults; ignored without onEvent. */
  streamOptions?: StreamOptions;
}

/**
 * @experimental @internal How LlmManager reports one generate() call. May change in any release.
 */
export interface GenerationEventSink {
  /** Emits step-start and a queued status; returns the new step's number. */
  stepStart(): number;
  /** The sink for the provider's events of this step; undefined means the call only observes and does not stream. */
  provider(step: number): Strategy.LLM.LlmStreamSink | undefined;
  /** The step's text after formatting; used when the provider streamed none. */
  stepText(step: number, text: string): void;
  toolCall(step: number, call: { toolCallId: string; name: string; args: Record<string, unknown> }): void;
  data(step: number, tool: { toolCallId: string; toolName: string }, name: string, data: unknown): void;
  toolResult(
    step: number,
    result: { toolCallId: string; name: string; status: 'succeeded' | 'failed'; durationMs: number }
  ): void;
  stepFinish(
    step: number,
    info: { finishReason: string; hadToolCalls: boolean; usage: Strategy.LLM.StreamUsage }
  ): void;
  /** Marks the response as not produced by the model (a prevented generation or an interceptor override). */
  markSynthetic(): void;
  loopLimitReached(): void;
  /** When the step first produced output, if it did. */
  firstOutputAt(step: number): Date | undefined;
}

export interface GenerateResult {
  ctx: ContextInterface;
  sessionId: Type.Entity.Session['id'];
  correlatorIds: RequestContext['correlatorIds'];
  messageIds: RequestContext['messageIds'];
  status: Status;
  messages: GenerateResultMessages;
  focusStatus?: Agent.FocusStatus;
}

// we use index because messages are not saved yet and have no own id
type index = number;
export interface BatchSaveOptions {
  saveAugmentedContext?: boolean | index[];
  saveDirectMessages?: boolean | index[];
  saveToolMessages?: boolean | index[];
  saveAssistantMessage?: boolean;
}

export type BatchSaveResult = Type.Entity.Message[];

export interface GenerateResultMessages {
  augmentedContext: Interface.FacadeEntity.InteractiveOutputMessage[] | []; // messages from knowledge base
  directMessages: Interface.FacadeEntity.InteractiveOutputMessage[] | [];
  llmResponse: Strategy.LLM.UnifiedLLMResponse;
  setAppendFn(
    appendFn: (
      sessionId: Type.Entity.Session['id'],
      message: Type.Entity.CreateMessage[]
    ) => Promise<Type.Entity.Message[]>
  ): void;
  save: (options?: BatchSaveOptions) => Promise<Type.Entity.Message[]>;
}

export interface AbstractLoftChatInterface {
  shutdown(): Promise<void>;
  createSession(
    newSession: Omit<Type.Entity.CreateSession, 'externalKey' | 'ctx'> & {
      externalKey?: Type.Entity.Session['externalKey']; // will be created empty  if not provided
      ctx?: Type.Entity.ContextRecord; // will be created empty if not provided
    }
  ): Promise<Type.Entity.Session>;
  deleteSession(sessionId: Type.Entity.Session['id']): Promise<void>;
  getSessionById(sessionId: Type.Entity.Session['id']): Promise<Type.Entity.Session>;
  getSessionByExternalKey(externalKey: Type.Entity.Session['externalKey']): Promise<Type.Entity.Session>;
  updateSessionSettings(
    sessionId: Type.Entity.Session['id'],
    correlatorId: string,
    settings: Partial<Type.Entity.Session>,
    forceChronologicalOrder?: boolean
  ): Promise<void>;
  getChatHistory(sessionId: Type.Entity.Session['id']): Promise<Util.QueryByArrayOfObjects<Type.Entity.Message>>;
}

export interface ChatInterface extends AbstractLoftChatInterface {
  sessionRepository?: Repository.Session;

  checkHealth(): Promise<boolean>;

  addMessages(sessionId: string, correlatorIds: string[], messages: Type.Entity.CreateMessage[]): Promise<void>;

  generate(options: Chat.GenerateOptions): Promise<Chat.GenerateResult>;

  shutdown(): Promise<void>;
}

/** @experimental Part of the Queued execution mode, which is not implemented yet. May change or be removed in any release. */
export interface ChatInterfaceWithSMG extends AbstractLoftChatInterface {
  appendMessages(sessionId: string, correlatorId: string, payload: ChatInputPayload): Promise<AppendMessagesResult>;

  processSessionActions(
    sessionId: Type.Entity.Session['id'],
    ctx?: ContextInterface,
    processAllAvailable?: boolean,
    returnWhenActionIs?: Type.SMG.MessageAction[]
  ): Promise<ProcessSessionActionsResult>;

  getPendingMessages(
    sessionId: Type.Entity.Session['id'],
    ctx?: ContextInterface,
    returnWhenActionIs?: Type.SMG.MessageAction[]
  ): Promise<GetPendingMessagesResult>;

  generate(options: Chat.GenerateOptions): Promise<Chat.GenerateResult>;

  getSessionState(sessionId: Type.SMG.Session['id']): Promise<Type.SMG.SessionState>;

  removeCompletedMessagesFromSMG(): Promise<void>;

  checkHealth(): Promise<boolean>;

  shutdown(): Promise<void>;
}
