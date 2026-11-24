# LOFT Interfaces Quick Reference

## Contents

- Enums
- Entity Types
- Chat API (via `loft.chat`)
- Streaming Events (`onEvent`)
- Tools (`additionalTools`, interceptors)
- Middleware Signatures
- ContextInterface (passed to middleware)
- LLM Strategy Interface
- Repository Interfaces
- Constructor Signatures (from `@moc-global/loft`)
- DI Symbols (DI_TYPES)
- Import Paths Summary

Key type signatures developers need. All from `@moc-global/loft-definitions` unless noted.

---

## Enums

```typescript
enum UnifiedMessageRole { system = 'system', user = 'user', assistant = 'assistant', function = 'function', tool = 'tool' }
enum LogLevel { NONE = 100, FATAL = 60, ERROR = 50, WARN = 40, INFO = 30, DEBUG = 20, TRACE = 10 }
enum LLMRequestType { GENERATE = 'GENERATE', GENERATE_STREAM = 'GENERATE_STREAM' }
enum Chat.Status {
  ERROR = 'ERROR', LOCKED = 'LOCKED', SUCCESS = 'SUCCESS',
  SUCCESS_STREAM = 'SUCCESS_STREAM',   // @deprecated — use chat.generate({ onEvent })
  ALREADY_PREPROCESSED = 'ALREADY_PREPROCESSED', ALREADY_GENERATED = 'ALREADY_GENERATED', SHUTDOWN = 'SHUTDOWN'
}
// Strategy.LLM.LoftFinishReason — usage.finishReason on responses LOFT made itself
enum LoftFinishReason { INTERCEPTOR_OVERRIDE = 'interceptor_override', MIDDLEWARE_OVERRIDE = 'middleware_override', MAX_LOOPS_EXCEEDED = 'max_loops_exceeded' }
```

---

## Entity Types

```typescript
type CreateSession = {
  ctx: ContextRecord;                                         // Record<string, any> of JSON values
  currentLlmName: string;
  currentManifestName: string;
  externalKey: Record<string, string | number | boolean>;
  focusAgent?: string | null;
};
type Session = CreateSession & { id: string; createdAt: Date; updatedAt: Date };

// Zod output type: every field except id is required in TypeScript.
// The schema defaults (content [], ctx {}, llmIgnore false) apply only when parsing untyped data at runtime.
type CreateMessage = {
  sessionId: string;
  role: UnifiedMessageRole;
  author: string;
  llmName: string;
  manifestName: string;
  content: FullContentPart[];
  ctx: ContextRecord;
  llmIgnore: boolean;
  id?: string;
};
type Message = CreateMessage & { id: string; sequenceId: string; createdAt: Date; updatedAt: Date };
```

### Content Part Types

All parts also accept an optional `_meta` object.

```typescript
type TextContent         = { type: 'text'; text: string };
type ImageContentBase64  = { type: 'image'; format: 'base64'; data: string; mimeType?: string; detail?: 'auto' | 'low' | 'high' };
type ImageContentUrl     = { type: 'image'; format: 'url'; url: string; detail?: 'auto' | 'low' | 'high' };
type AudioContent        = { type: 'audio'; data: string; mimeType: string };
type ToolCallContent     = { type: 'tool_call'; method: 'tools/call'; callId?: string; params: { name: string; arguments?: Record<string, unknown> } };
type ToolResultContent   = { type: 'tool_result'; callId?: string; content: ContentBlock[]; isError?: boolean };
type EmbeddedResource    = { type: 'resource'; resource: { uri: string; mimeType?: string; text: string } | { uri: string; mimeType?: string; blob: string } };
type ResourceLink        = { type: 'resource_link'; uri: string; name: string; title?: string; description?: string; mimeType?: string };
type FullContentPart     = TextContent | ImageContentBase64 | ImageContentUrl | AudioContent | ResourceLink | EmbeddedResource | ToolCallContent | ToolResultContent;
```

---

## Chat API (via `loft.chat`)

```typescript
interface ChatInterface {
  createSession(newSession: { currentLlmName: string; currentManifestName: string; focusAgent?: string | null;
    externalKey?: Record<string, string | number | boolean>; ctx?: ContextRecord }): Promise<Session>; // ctx/externalKey default to {}
  deleteSession(sessionId: string): Promise<void>;
  getSessionById(sessionId: string): Promise<Session>;              // rejects with SessionNotFoundError
  getSessionByExternalKey(externalKey: Session['externalKey']): Promise<Session>;
  updateSessionSettings(sessionId: string, correlatorId: string, settings: Partial<Session>, forceChronologicalOrder?: boolean): Promise<void>;
  getChatHistory(sessionId: string): Promise<QueryByArrayOfObjects<Message>>; // extends Array<Message> with query methods
  addMessages(sessionId: string, correlatorIds: string[], messages: CreateMessage[]): Promise<void>;
  generate(options: Chat.GenerateOptions): Promise<Chat.GenerateResult>;
  checkHealth(): Promise<boolean>;
  shutdown(): Promise<void>;
}

interface GenerateOptions {
  sessionId: string;
  ctx?: ContextInterface;
  directMessages?: CreateMessage[];
  augmentedContext?: CreateMessage[];
  correlatorIds?: string[];
  temporaryLlmName?: string;
  temporaryManifestName?: string;
  llmContextWindow?: number;                    // chat history messages to keep
  additionalTools?: AdditionalTool[];           // per-call tools, see Tools
  focusAgent?: string | null;                   // registered Focus name; null disables session-level Focus for this call
  signal?: AbortSignal;                         // cancels the LLM request and tool loop; generate() then rejects
  onEvent?: (event: ChatStreamEvent) => void;   // @experimental — synchronous; returned promises are not awaited
  streamOptions?: StreamOptions;                // @experimental — ignored without onEvent
}

interface GenerateResult {
  ctx: ContextInterface;
  sessionId: string;
  correlatorIds: string[];
  messageIds: { augmentedContext: string[]; directMessages: string[]; all: string[] };
  status: Chat.Status;
  messages: GenerateResultMessages;
  focusStatus?: Agent.FocusStatus;
}

interface GenerateResultMessages {
  augmentedContext: InteractiveOutputMessage[] | [];
  directMessages: InteractiveOutputMessage[] | [];
  llmResponse: UnifiedLLMResponse;
  save: (options?: BatchSaveOptions) => Promise<Message[]>;
}

interface BatchSaveOptions {            // arrays are indexes (messages have no ids before saving)
  saveAugmentedContext?: boolean | number[];
  saveDirectMessages?: boolean | number[];
  saveToolMessages?: boolean | number[];
  saveAssistantMessage?: boolean;
}
```

---

## Streaming Events (`onEvent`)

`Chat.ChatStreamEvent`, `Chat.StreamOptions` (all `@experimental`). Every event has `seq: number` (0, 1, 2… per call) and `runId: string`.

```typescript
type ChatStreamEvent = ChatStreamEventBase & (
  | { type: 'start'; sessionId: string; textPolicy: 'all' | 'after-middleware'; streaming: boolean }
  | { type: 'status'; step: number; phase: 'queued' | 'generating' }
  | { type: 'step-start'; step: number }
  | { type: 'text-delta'; step: number; delta: string }
  | { type: 'reasoning-delta'; step: number; delta: string }
  | { type: 'tool-call'; step: number; toolCallId: string; name: string; args?: Record<string, unknown> }
  | { type: 'data'; step: number; toolCallId: string; toolName: string; name: string; data: unknown }
  | { type: 'tool-result'; step: number; toolCallId: string; name: string; status: 'succeeded' | 'failed'; durationMs: number }
  | { type: 'step-finish'; step: number; reason: ChatFinishReason; finishReason: string; hadToolCalls: boolean; streamed: boolean; usage?: StreamUsage }
  | { type: 'finish'; reason: ChatFinishReason; finishReason: string; text: string; textReplaced: boolean; usage: StreamUsage }
  | { type: 'error'; code: 'provider_error' | 'rate_limited' | 'timeout' | 'internal'; message: string; retryable: boolean; retryAfterMs?: number }
  | { type: 'abort'; reason: 'timeout' | 'cancelled' }
);
type ChatFinishReason = 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other';
type StreamUsage = Omit<UnifiedUsage, 'generateStartTime'>;   // Strategy.LLM.StreamUsage

interface StreamOptions {
  enabled?: boolean;                                         // false = observe-only. Default true
  include?: { reasoning?: boolean;                           // default false
              toolCalls?: 'none' | 'names' | 'args' };       // default 'names'
  textPolicy?: 'all' | 'after-middleware';                   // default: 'after-middleware' if output-transforming middleware is registered, else 'all'
}
```

`finish.text` is the final reply text to show. Library-wide defaults: `ChatConfig.streaming` (see Constructors); a call's `streamOptions` are merged over them key by key.

---

## Tools (`additionalTools`, interceptors)

```typescript
// Chat.AdditionalTool — passed in GenerateOptions.additionalTools
interface AdditionalTool {
  definition: { name: string; description: string;
    inputSchema: { type: AdditionalToolSchemaType.OBJECT /* 'object' */; properties?: Record<string, object>; required?: string[] } };
  handler(args: Record<string, unknown>, context?: AdditionalToolContext): Promise<AdditionalToolResult>;
}
interface AdditionalToolContext {
  signal?: AbortSignal;                       // aborted when the generate() call is cancelled
  emit(name: string, data: unknown): void;    // @experimental — sends a 'data' event; no-op without onEvent
}
interface AdditionalToolResult {
  content: Array<{ type: AdditionalToolContentType.TEXT /* 'text' */; text: string }>;
  isError?: boolean;
}

// Interface.ToolInterceptor — registered with chatConstructor.registerToolInterceptor(mcpToolName, interceptor)
type ToolInterceptor = (params: ToolInterceptorParams) => Promise<CallToolResult>;
interface ToolInterceptorParams {
  ctx: ContextInterface;
  toolRequest: ToolCallContent;
  calledTool: Tool;                                      // MCP Tool
  toolChain: InteractiveOutputMessage[];
  executeToolFn: (options: { params: CallToolRequest['params']; clientNames?: string[] }) => Promise<CallToolResult>;
  callLimits: { current: number; max: number };
  toolClients: Array<{ clientName: string; metadata: Record<string, any> }>;
  preventGenerate: (overrideGeneratePayload: OverrideGeneratePayload) => void;
}

// Interface.MCP.MCPClientMetadata — useMcpClient(name, client, metadata?: Partial<MCPClientMetadata>)
interface MCPClientMetadata { transportType: string; registeredAt: string; toolCount: number; [key: string]: any }
```

---

## Middleware Signatures

```typescript
type BaseMiddleware<TContext, TPayload, TResult, TStrategy> = (context: TContext, payload: TPayload, chain: TStrategy) => Promise<TPayload>;

// InputMiddleware & AfterGenerateMiddleware
type StandardMiddleware<TContext, TPayload> = BaseMiddleware<TContext, TPayload, ChainResult<TPayload>, StandardChainStrategy<TContext, TPayload>>;

// BeforeGenerateMiddleware — can prevent LLM call
type BeforeGenerateMiddleware<TContext, TPayload> = BaseMiddleware<TContext, TPayload, BeforeGenerateChainResult<TPayload>, BeforeGenerateChainStrategy<TContext, TPayload>>;

// Chain methods
interface StandardChainStrategy<TContext, TPayload> {   // = BaseChainStrategy
  nextCalled: boolean;
  ctx: TContext;
  updateCtx(update: Partial<TContext>): void;
  next(): void;
  getResult(payload: TPayload): TResult;
}

interface BeforeGenerateChainStrategy<TContext, TPayload> extends BaseChainStrategy<TContext, TPayload, BeforeGenerateChainResult<TPayload>> {
  preventGeneration(overrideGeneratePayload: OverrideGeneratePayload): void;
  isGenerationPrevented: boolean;
  overrideGenerateResponse: OverrideGeneratePayload | null;
}

type OverrideGeneratePayload = { content: FullContentPart[]; role: UnifiedMessageRole; llmName?: string; manifestName?: string };
```

### Concrete payload types per stage

- **InputMiddleware** — `StandardMiddleware<ContextInterface, GenerateRequestParameters>`
- **BeforeGenerateMiddleware** — `BeforeGenerateMiddleware<ContextInterface, GenerateRequestParameters>`
- **AfterGenerateMiddleware** — `StandardMiddleware<ContextInterface, Chat.GenerateResultMessages>`
- **Strategy response middleware** (`strategy.useMiddleware(name, mw, options?)`) — `Middleware<ContextInterface, Strategy.LLM.UnifiedLLMResponse>`

---

## ContextInterface (passed to middleware)

```typescript
interface ContextInterface {
  get request(): RequestContext;
  readonly session: Interface.FacadeEntity.Session;    // Session + update(data?: Partial<Pick<Session, 'currentLlmName' | 'currentManifestName' | 'ctx' | 'focusAgent'>>)
  readonly chatHistory: Interface.FacadeEntity.ChatHistory;
  readonly tracer: Strategy.Tracer.Tracer;
  generate(llmName: string, systemMessageName: string): Promise<UnifiedLLMResponse>;
  aiTask(llmName: string, aiTaskName: string, content: string | Message[]): Promise<UnifiedLLMResponse>;
  getPrompt(promptName: string, llmName: string): Promise<string>;
}

interface RequestContext {
  readonly correlatorIds: string[];
  readonly messageIds: { readonly augmentedContext: string[]; readonly directMessages: string[]; readonly all: string[] };
  messages: GenerateRequestParameters & { all: CreateMessage[] };
}

interface GenerateRequestParameters {
  augmentedContext: CreateMessage[];
  directMessages: CreateMessage[];
  temporaryRequestConfig?: { llmName?: string; manifestName?: string; llmContextWindow?: number; [key: string]: unknown };
  tags?: string[];
}
```

---

## LLM Strategy Interface

```typescript
interface LoftLLM<T_LLM_REQ, T_LLM_RES> {
  readonly llmName: string;
  generate(llmRequest: LLMRequest<T_LLM_REQ>, options?: CallOptions): Promise<LlmResponse<T_LLM_RES>>;
  generateStream?(llmRequest: LLMRequest<T_LLM_REQ>): Promise<UnifiedLLMStream>;   // @deprecated — use chat.generate({ onEvent })
  generateQueued(llmRequest: LLMRequest<T_LLM_REQ>): Promise<void>;
  formatToLLMRequest(correlatorIds: string[], computedSystemMessage: string, llmManifestProps: LLMManifestProps['modelPreset'],
    chatHistory: Message[], mcpTools: ListToolsResult['tools']): Promise<T_LLM_REQ>;
  formatToUnifiedLLMResponse(correlatorIds: string[], sessionId: string, originalResponse: T_LLM_RES, llmName: string, manifestName: string): UnifiedLLMResponse;
  generateModelPresetSchema(): ZodSchema<any>;
  generateResponseSchema(): ZodSchema<any>;
  executeMiddlewareChain(ctx: ContextInterface, response: UnifiedLLMResponse, correlatorIds: string[]): Promise<UnifiedLLMResponse>;
  getHealthCheckStatus(): Promise<boolean>;
  hasOutputMiddleware?(): boolean;   // @experimental
  stop?(): void;                     // called by LOFT.shutdown()
  prepareGenerateRequest(correlatorIds: string[], sessionId: string, messages: CreateMessage[], computedManifestMessage: string,
    modelPreset: LLMManifestProps['modelPreset'], mpcTools?: ListToolsResult['tools'], priority?: number): Promise<LLMRequest<T_LLM_REQ>>;
}

interface CallOptions {
  signal?: AbortSignal;
  onEvent?: LlmStreamSink;   // @experimental — set by LOFT to stream this call
}

interface UnifiedLLMResponse {
  choices: InteractiveOutputMessage[];
  topChoice: InteractiveOutputMessage;
  usedTools?: Array<InteractiveOutputMessage & { role: UnifiedMessageRole.assistant | UnifiedMessageRole.tool }>;
  usage: UnifiedUsage;
  originalResponse: any;
}

interface UnifiedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheTokens?: number;
  reasoningTokens?: number;
  totalCost?: number;
  generateStartTime?: Date;
  model?: string;
  finishReason?: string;     // provider's value, or a LoftFinishReason
}
```

Extend `AbstractLoftLLM` (`constructor(callManagerStrategy?: Strategy.CallManager, loftQueue?: Strategy.LoftQueue)`) for default implementations of `generate`, `generateQueued`, `prepareGenerateRequest`, `executeMiddlewareChain`, `getHealthCheckStatus`, `hasOutputMiddleware`, `stop`, plus `useMiddleware(name, middleware, options?: { transformsOutput?: boolean })`. Subclasses implement `llmName`, `log`, `formatToLLMRequest`, `formatToUnifiedLLMResponse`, `generateModelPresetSchema`, `generateResponseSchema`.

---

## Repository Interfaces

```typescript
interface Repository.Session {
  focus?: Agent.FocusStateStore;
  create(newSession: CreateSession): Promise<Session>;
  getById(sessionId: string): Promise<Session>;                       // rejects with SessionNotFoundError
  getByExternalKey(externalKey: Session['externalKey']): Promise<Session>; // rejects with SessionNotFoundError
  updateById(sessionId: string, newSession: Partial<Session>): Promise<Session>;
  deleteById(sessionId: string): Promise<void>;
  checkHealth(): Promise<boolean>;
  end(): Promise<void>;
}

interface Repository.ChatHistory {
  addMessages(sessionId: string, messages: CreateMessage[]): Promise<Message[]>;
  getMessages(sessionId: string, options?: { limit?: number }): Promise<Message[]>; // limit: latest N, chronological
  checkHealth(): Promise<boolean>;
  end(): Promise<void>;
}

interface Repository.ChatHistoryPatcher {
  getPatches(sessionId: string): Promise<MessagePatch[]>;
  patchMessages(sessionId: string, messageIds: string[], patchData: Partial<CreateMessagePatch>): Promise<MessagePatch[]>;
  checkHealth(): Promise<boolean>;
  end(): Promise<void>;
}

interface Repository.ObjectStorage {
  get(filePath: string): Promise<Record<string, any>>;
  upload(filePath: string, data: Record<string, any>): Promise<void>;
  remove(filePath: string): Promise<void>;
  checkHealth(): Promise<boolean>;
}
```

---

## Constructor Signatures (from `@moc-global/loft`)

```typescript
class LoftConstructor<TChatInterface extends Chat.ChatInterface | Chat.ChatInterfaceWithSMG, TLoft extends LOFT<TChatInterface> = LOFT<TChatInterface>> {
  constructor(
    loftConfig: LoftConfig,                                  // { logLevel?: Interface.LogLevel }
    manifestManagerConstructor: Interface.BaseModuleConstructor<Interface.ManifestManager>,
    chatConstructor?: ChatConstructorType<TChatInterface>,
    tracerStrategy?: Strategy.Tracer.TracerFactory,
    logStrategy?: Interface.LoggerStrategy
  );
  registerLlmStrategy<T_LLM_Req, T_LLM_Res>(llmName: string, llmStrategy: LoftLLM<T_LLM_Req, T_LLM_Res>, forceOverwrite?: boolean): Promise<void>;
  registerGMComputer(manifestName: string, llmName: string, handler: Interface.PromptComputer<ContextInterface>): void;
  registerATMComputer(manifestName: string, llmName: string, handler: Interface.PromptComputer<ContextInterface>): void;
  registerPromptComputer(promptName: string, llmName: string, handler: Interface.PromptComputer<ContextInterface>): void;
  validateManifest(): Promise<void>;     // loads and validates manifests; rejects when invalid
  getInstance(): TLoft;
  gracefulShutdown(): Promise<void>;     // @deprecated — LOFT.shutdown() shuts the tracer down
}

class LOFT<TChatInterface> {
  readonly chat: TChatInterface;
  registerFocus(name: string, config: Agent.Focus): void;
  getFocus(name: string): Agent.Focus | undefined;
  shutdown(): Promise<void>;
}

class ChatConstructor<T = BaseLoftChat> {
  constructor(
    sessionRepositoryConstructor: Interface.BaseComponentConstructor<Repository.Session>,
    chatHistoryRepositoryConstructor: Interface.BaseComponentConstructor<Repository.ChatHistory>,
    chatHistoryPatcherRepositoryConstructor?: Interface.BaseComponentConstructor<Repository.ChatHistoryPatcher>,
    llmContextWindowCropper?: Strategy.LlmContextWindowCropper,
    chatConfig?: ChatConfig
  );
  registerInputMiddleware(name: string, middleware: StandardMiddleware<ContextInterface, GenerateRequestParameters>): void;
  registerBeforeGenerateMiddleware(name: string, middleware: BeforeGenerateMiddleware<ContextInterface, GenerateRequestParameters>): void;
  registerAfterGenerateMiddleware(name: string, middleware: StandardMiddleware<ContextInterface, Chat.GenerateResultMessages>,
    options?: { transformsOutput?: boolean }): void;   // transformsOutput (@experimental): false = does not change reply text. Default true
  useMcpClient(mcpName: string, mcpClient: Client, metadata?: Partial<Interface.MCP.MCPClientMetadata>): Promise<void>;
  registerToolInterceptor(mcpToolName: string, interceptor: Interface.ToolInterceptor): void;
}

interface ChatConfig {
  shutdownTimeout?: number;          // ms shutdown() waits for in-flight requests; no limit when unset
  historyLimit?: number;             // max latest history messages loaded per request; default all
  mcp?: { toolCacheTtl?: number; maxCallsPerGenerate?: number };
  streaming?: Chat.StreamOptions;    // @experimental — defaults for calls that pass onEvent
}

type PromptComputer<PromptContext> = (promptCtx: PromptContext, prompt: { name: string; content: string }, modelPreset?: Type.LLMManifestProps['modelPreset']) => Promise<string>;
// When registering via LoftConstructor, PromptContext is ContextInterface
```

---

## DI Symbols (DI_TYPES)

All symbols from `@moc-global/loft-definitions/src/DITypes.ts`:

```typescript
// Core
DI_TYPES.LOFT                          // LOFT facade
DI_TYPES.ChatStrategy                  // ChatInterface implementation (BaseLoftChat)
DI_TYPES.ChatConfig                    // ChatConfig object
DI_TYPES.FocusRegistry                 // Focus configs added with loft.registerFocus()
// Managers
DI_TYPES.LlmManager                    // LLM strategy registry
DI_TYPES.ManifestManager               // Manifest cache + resolution
DI_TYPES.ManifestManagerConfig
DI_TYPES.ManifestRepository            // ObjectStorage holding manifests
DI_TYPES.ChatHistoryManager            // Chat history manager
DI_TYPES.MCPManager                    // MCP tool registry
DI_TYPES.ToolInterceptorManager        // Tool interceptors
DI_TYPES.GMComputerManager             // Generate manifest computers
DI_TYPES.ATMComputerManager            // AI task manifest computers
DI_TYPES.PromptComputerManager         // Prompt template computers
// Repositories
DI_TYPES.SessionRepository             // Session persistence
DI_TYPES.ChatHistoryRepository         // Chat history persistence
DI_TYPES.ChatHistoryPatcherRepository  // Optional message patches
// Middleware
DI_TYPES.InputMiddleware               // Input middleware manager
DI_TYPES.BeforeGenerateMiddlewareManager
DI_TYPES.AfterGenerateMiddlewareManager
// Infrastructure
DI_TYPES.TracerStrategy                // Observability tracer (default NoOpTracerStrategy)
DI_TYPES.ContextProvider
DI_TYPES.GenerateResultMessagesProvider
DI_TYPES.LlmContextWindowCropper
DI_TYPES.LoftHealthCheck
// Present but not bound in the standard setup
DI_TYPES.BaseLoft, DI_TYPES.PromptManager, DI_TYPES.ManifestRepositoryConfig, DI_TYPES.ResultCallBack, DI_TYPES.ErrorHandler
DI_TYPES.StreamLoft                    // @experimental, reserved; stream with chat.generate({ onEvent })
DI_TYPES.QueuedLoft, DI_TYPES.OutgoingQueue   // @experimental, Queued mode not implemented
```

---

## Import Paths Summary

```typescript
// Types, interfaces, enums
import { DI_TYPES, Interface, Repository, Strategy, Type, Schema, Chat, Agent, ContextInterface,
  GenerateRequestParameters, StandardMiddleware, BeforeGenerateMiddleware,
  Logger, NativeCallManagerStrategy, SessionNotFoundError } from '@moc-global/loft-definitions';

// Note: LogLevel is NOT a top-level export — use Interface.LogLevel
// Note: UnifiedMessageRole is NOT a top-level export — use Type.LLM.UnifiedMessageRole
// Note: ChatStreamEvent / StreamOptions / AdditionalTool live under Chat.*; ToolInterceptor under Interface.*

// Constructors
import { LoftConstructor, ChatConstructor, ManifestManagerConstructor,
  FsRepositoryConstructor, LOFT, BaseLoftChat } from '@moc-global/loft';
```
