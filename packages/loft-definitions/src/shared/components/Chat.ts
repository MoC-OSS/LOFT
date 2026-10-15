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

export enum Status {
  ERROR = 'ERROR',
  LOCKED = 'LOCKED',
  SUCCESS = 'SUCCESS',
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

/** @experimental Part of the Stream and Queued execution modes, which are not implemented yet. May change or be removed in any release. */
export type SMGActionResult =
  | SMGProcessor.SMGMessageActionReturn['CHAT_APPEND']
  | SMGProcessor.SMGMessageActionReturn['MESSAGE_ARCHIVE']
  | SMGProcessor.SMGMessageActionReturn['SESSION_UPDATE'];

/** @experimental Part of the Stream and Queued execution modes, which are not implemented yet. May change or be removed in any release. */
export interface AppendMessagesResult {
  ctx: ContextInterface;
  sessionId: string;
  correlatorIds: string[];
  messageIds: string[];
  status: Status;
}

/** @experimental Part of the Stream and Queued execution modes, which are not implemented yet. May change or be removed in any release. */
export interface ProcessSessionActionsResult {
  ctx: ContextInterface;
  sessionId: string;
  correlatorIds: string[];
  messageIds: string[];
  messagesActionStatus: SMGActionResult[];
  status: Status;
  messagesBeforeAction: Type.SMG.Message[];
}

/** @experimental Part of the Stream and Queued execution modes, which are not implemented yet. May change or be removed in any release. */
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
  handler: (args: Record<string, unknown>) => Promise<AdditionalToolResult>;
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

/** @experimental Part of the Stream and Queued execution modes, which are not implemented yet. May change or be removed in any release. */
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
