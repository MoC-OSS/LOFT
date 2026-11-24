# LOFT Interfaces Quick Reference

## Contents

- Enums
- Entity Types
- Chat API (via `loft.chat`)
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
enum Chat.Status { ERROR, LOCKED, SUCCESS, SUCCESS_STREAM, ALREADY_PREPROCESSED, ALREADY_GENERATED, SHUTDOWN }
```

---

## Entity Types

```typescript
type CreateSession = {
  ctx: Record<string, unknown>;
  currentLlmName: string;
  currentManifestName: string;
  externalKey?: Record<string, string | number | boolean>;
};

type CreateMessage = {
  sessionId: string;
  role: UnifiedMessageRole;
  author: string;
  llmName: string;
  manifestName: string;
  content: FullContentPart[];        // defaults to []
  id?: string;
  ctx?: Record<string, unknown>;     // defaults to {}
  llmIgnore?: boolean;               // defaults to false
};
```

### Content Part Types

```typescript
type TextContent         = { type: 'text'; text: string };
type ImageContentBase64  = { type: 'image'; format: 'base64'; data: string; mimeType?: string };
type ImageContentUrl     = { type: 'image'; format: 'url'; url: string };
type AudioContent        = { type: 'audio'; data: string; mimeType: string };
type ToolCallContent     = { type: 'tool_call'; method: 'tools/call'; callId?: string; params: { name: string; arguments?: Record<string, unknown> } };
type ToolResultContent   = { type: 'tool_result'; callId?: string; content: ContentBlock[]; isError?: boolean };
type EmbeddedResource    = { type: 'resource'; resource: { uri: string; mimeType?: string; text?: string; blob?: string } };
type ResourceLink        = { type: 'resource_link'; uri: string; mimeType?: string; name?: string };
type FullContentPart     = TextContent | ImageContentBase64 | ImageContentUrl | AudioContent | EmbeddedResource | ResourceLink | ToolCallContent | ToolResultContent;
```

---

## Chat API (via `loft.chat`)

```typescript
interface ChatInterface {
  createSession(config: { currentLlmName: string; currentManifestName: string; ctx: Record<string, unknown>; externalKey?: Record<string, string | number | boolean> }): Promise<Session>;
  deleteSession(sessionId: string): Promise<void>;
  getSessionById(sessionId: string): Promise<Session>;
  getSessionByExternalKey(externalKey: Record<string, string | number | boolean>): Promise<Session>;
  updateSessionSettings(sessionId: string, correlatorId: string, settings: Partial<Session>, forceChronologicalOrder?: boolean): Promise<void>;
  getChatHistory(sessionId: string): Promise<QueryByArrayOfObjects<Message>>; // extends Array<Message> with query methods
  addMessages(sessionId: string, correlatorIds: string[], messages: CreateMessage[]): Promise<void>;
  generate(options: GenerateOptions): Promise<GenerateResult>;
  checkHealth(): Promise<boolean>;
  shutdown(): Promise<void>;
}

interface GenerateOptions {
  sessionId: string;
  directMessages?: CreateMessage[];
  augmentedContext?: CreateMessage[];
  correlatorIds?: string[];
  temporaryLlmName?: string;
  temporaryManifestName?: string;
  llmContextWindow?: number;
}

interface GenerateResult {
  ctx: ContextInterface;
  sessionId: string;
  correlatorIds: string[];
  messageIds: { augmentedContext: string[]; directMessages: string[]; all: string[] };
  status: Chat.Status;
  messages: GenerateResultMessages;
}

interface GenerateResultMessages {
  llmResponse: UnifiedLLMResponse;
  directMessages: InteractiveOutputMessage[];
  augmentedContext: InteractiveOutputMessage[];
  save(options?: BatchSaveOptions): Promise<Message[]>;
}

interface BatchSaveOptions {
  saveAugmentedContext?: boolean | number[];
  saveDirectMessages?: boolean | number[];
  saveToolMessages?: boolean | number[];
  saveAssistantMessage?: boolean;
}
```

---

## Middleware Signatures

```typescript
// InputMiddleware & AfterGenerateMiddleware
type StandardMiddleware<TContext, TPayload> = (
  context: TContext, payload: TPayload, chain: StandardChainStrategy<TContext, TPayload>
) => Promise<TPayload>;

// BeforeGenerateMiddleware — can prevent LLM call
type BeforeGenerateMiddleware<TContext, TPayload> = (
  context: TContext, payload: TPayload, chain: BeforeGenerateChainStrategy<TContext, TPayload>
) => Promise<TPayload>;

// Chain methods
interface StandardChainStrategy<TContext, TPayload> {
  next(): void;
  updateCtx(update: Partial<TContext>): void;
}

interface BeforeGenerateChainStrategy<TContext, TPayload> extends StandardChainStrategy<TContext, TPayload> {
  preventGeneration(override: { content: FullContentPart[]; role: UnifiedMessageRole; llmName?: string; manifestName?: string }): void;
  isGenerationPrevented: boolean;
}
```

### Concrete payload types per stage

- **InputMiddleware** — `StandardMiddleware<ContextInterface, GenerateRequestParameters>`
- **BeforeGenerateMiddleware** — `BeforeGenerateMiddleware<ContextInterface, GenerateRequestParameters>`
- **AfterGenerateMiddleware** — `StandardMiddleware<ContextInterface, Strategy.LLM.UnifiedLLMResponse>`

---

## ContextInterface (passed to middleware)

```typescript
interface ContextInterface {
  readonly session: Interface.FacadeEntity.Session;    // extends Type.Entity.Session with update()
  readonly chatHistory: Interface.FacadeEntity.ChatHistory;
  readonly tracer: Strategy.Tracer.Tracer;
  get request(): RequestContext;
  generate(llmName: string, systemMessageName: string): Promise<UnifiedLLMResponse>;
  aiTask(llmName: string, aiTaskName: string, content: string | Message[]): Promise<UnifiedLLMResponse>;
  getPrompt(promptName: string, llmName: string): Promise<string>;
}

interface GenerateRequestParameters {
  augmentedContext: CreateMessage[];
  directMessages: CreateMessage[];
  temporaryRequestConfig?: { llmName?: string; manifestName?: string; llmContextWindow?: number };
  tags?: string[];
}
```

---

## LLM Strategy Interface

```typescript
interface LoftLLM<T_REQ, T_RES> {
  readonly llmName: string;
  generate(request: LLMRequest<T_REQ>): Promise<LlmResponse<T_RES>>;
  generateStream?(request: LLMRequest<T_REQ>): Promise<UnifiedLLMStream>;
  generateQueued(request: LLMRequest<T_REQ>): Promise<void>;
  formatToLLMRequest(correlatorIds: string[], systemMessage: string, modelPreset: unknown, chatHistory: Message[], mcpTools: Tool[]): Promise<T_REQ>;
  formatToUnifiedLLMResponse(correlatorIds: string[], sessionId: string, response: T_RES, llmName: string, manifestName: string): UnifiedLLMResponse;
  generateModelPresetSchema(): ZodSchema;
  generateResponseSchema(): ZodSchema;
}

interface UnifiedLLMResponse {
  choices: InteractiveOutputMessage[];
  topChoice: InteractiveOutputMessage;
  usedTools?: InteractiveOutputMessage[];
  usage: UnifiedUsage;
  originalResponse: unknown;
}

interface UnifiedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheTokens?: number;
  reasoningTokens?: number;
  totalCost?: number;
  model?: string;
  finishReason?: string;
}
```

Extend `AbstractLoftLLM` for default implementations of `generate`, `generateQueued`, `prepareGenerateRequest`.

---

## Repository Interfaces

```typescript
interface Repository.Session {
  create(session: CreateSession): Promise<Session>;
  getById(id: string): Promise<Session>;
  getByExternalKey(key: Record<string, unknown>): Promise<Session>;
  updateById(id: string, data: Partial<Session>): Promise<Session>;
  deleteById(id: string): Promise<void>;
  checkHealth(): Promise<boolean>;
  end(): Promise<void>;
}

interface Repository.ChatHistory {
  addMessages(sessionId: string, messages: CreateMessage[]): Promise<Message[]>;
  getMessages(sessionId: string): Promise<Message[]>;
  checkHealth(): Promise<boolean>;
  end(): Promise<void>;
}

interface Repository.ObjectStorage {
  get(path: string): Promise<Record<string, unknown>>;
  upload(path: string, data: Record<string, unknown>): Promise<void>;
  remove(path: string): Promise<void>;
  checkHealth(): Promise<boolean>;
}
```

---

## Constructor Signatures (from `@moc-global/loft`)

```typescript
class LoftConstructor<TChatInterface> {
  constructor(
    config: { logLevel?: LogLevel },
    manifestManagerConstructor: BaseModuleConstructor<ManifestManager>,
    chatConstructor?: ChatConstructorType<TChatInterface>,
    tracerStrategy?: TracerFactory,
    logStrategy?: LoggerStrategy
  );
  registerLlmStrategy(llmName: string, strategy: LoftLLM<unknown, unknown>, forceOverwrite?: boolean): Promise<void>;
  registerGMComputer(manifestName: string, llmName: string, handler: PromptComputer): void;
  registerATMComputer(manifestName: string, llmName: string, handler: PromptComputer): void;
  registerPromptComputer(promptName: string, llmName: string, handler: PromptComputer): void;
  getInstance(): LOFT<TChatInterface>;
  gracefulShutdown(): Promise<void>;
}

class ChatConstructor {
  constructor(
    sessionRepo: BaseComponentConstructor<Repository.Session>,
    chatHistoryRepo: BaseComponentConstructor<Repository.ChatHistory>,
    chatHistoryPatcherRepo?: BaseComponentConstructor<Repository.ChatHistoryPatcher>,
    contextWindowCropper?: LlmContextWindowCropper,
    chatConfig?: { mcp?: { toolCacheTtl?: number; maxCallsPerGenerate?: number } }
  );
  registerInputMiddleware(name: string, mw: StandardMiddleware<ContextInterface, GenerateRequestParameters>): void;
  registerBeforeGenerateMiddleware(name: string, mw: BeforeGenerateMiddleware<ContextInterface, GenerateRequestParameters>): void;
  registerAfterGenerateMiddleware(name: string, mw: StandardMiddleware<ContextInterface, UnifiedLLMResponse>): void;
  useMcpClient(name: string, client: Client, metadata?: Partial<MCPClientMetadata>): Promise<void>;
  registerToolInterceptor(toolName: string, interceptor: ToolInterceptor): void;
}

type PromptComputer<PromptContext> = (promptCtx: PromptContext, prompt: { name: string; content: string }, modelPreset?: Type.LLMManifestProps['modelPreset']) => Promise<string>;
// When registering via LoftConstructor, PromptContext is ContextInterface
```

---

## DI Symbols (DI_TYPES)

Key symbols from `@moc-global/loft-definitions/src/DITypes.ts`:

```typescript
DI_TYPES.LOFT                          // LOFT facade
DI_TYPES.ChatStrategy                  // ChatInterface implementation
DI_TYPES.LlmManager                   // LLM strategy registry
DI_TYPES.ManifestManager              // Manifest cache + resolution
DI_TYPES.SessionRepository            // Session persistence
DI_TYPES.ChatHistoryRepository        // Chat history persistence
DI_TYPES.ChatHistoryManager           // Chat history manager
DI_TYPES.InputMiddleware              // Input middleware manager
DI_TYPES.BeforeGenerateMiddlewareManager
DI_TYPES.AfterGenerateMiddlewareManager
DI_TYPES.MCPManager                   // MCP tool registry
DI_TYPES.ToolInterceptorManager       // Tool interceptors
DI_TYPES.TracerStrategy               // Observability tracer
DI_TYPES.GMComputerManager            // Generate manifest computers
DI_TYPES.ATMComputerManager           // AI task manifest computers
DI_TYPES.PromptComputerManager        // Prompt template computers
```

---

## Import Paths Summary

```typescript
// Types, interfaces, enums
import { DI_TYPES, Interface, Repository, Strategy, Type, Chat, ContextInterface,
  GenerateRequestParameters, StandardMiddleware, BeforeGenerateMiddleware,
  Logger, NativeCallManagerStrategy } from '@moc-global/loft-definitions';

// Note: LogLevel is NOT a top-level export — use Interface.LogLevel
// Note: UnifiedMessageRole is NOT a top-level export — use Type.LLM.UnifiedMessageRole

// Constructors
import { LoftConstructor, ChatConstructor, ManifestManagerConstructor,
  FsRepositoryConstructor, LOFT, BaseLoftChat } from '@moc-global/loft';
```
