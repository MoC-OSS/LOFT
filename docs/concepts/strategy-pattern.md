# Strategy Pattern

LOFT uses the Strategy Pattern to make LLM providers, storage backends, call managers, and tracers pluggable. You choose implementations at initialization time, and LOFT interacts with them through interfaces defined in `@moc-global/loft-definitions`.

## LLM Strategies

### The LoftLLM Interface

Every LLM provider implements the `LoftLLM` interface (via `Strategy.LLM.AbstractLoftLLM`). The key methods:

| Method | Purpose |
|--------|---------|
| `formatToLLMRequest()` | Convert unified messages + system message + model preset to provider-specific request format |
| `formatToUnifiedLLMResponse()` | Convert provider response back to LOFT's `UnifiedLLMResponse` |
| `generate(request, options?)` | Make an LLM API call through the call manager. `options` carries the abort `signal` and, when the chat streams, an event sink (`onEvent`) |
| `generateStream(request)` | Deprecated: use `chat.generate({ onEvent })` instead. Removed in the next major release |
| `generateQueued(request)` | Enqueue an LLM call for deferred processing (via queue strategy). **Incomplete — see note below.** |
| `generateModelPresetSchema()` | Return a Zod schema for validating the `modelPreset` in manifests |
| `generateResponseSchema()` | Return a Zod schema for validating the LLM response |
| `executeMiddlewareChain()` | Run strategy-level middleware on the response |
| `prepareGenerateRequest()` | Build the full `LLMRequest` (calls `formatToLLMRequest` internally) |
| `getHealthCheckStatus()` | Health check for the LLM strategy; asks its call manager (`NativeCallManagerStrategy` always reports healthy) |

### Three-Layer Architecture

Each LLM integration is composed of three layers:

```
┌──────────────────────────────────────────────────┐
│  LoftStrategy (e.g., OpenAiLoftStrategy)         │
│                                                   │
│  Knows how to:                                    │
│  - Format messages to/from provider format        │
│  - Build model preset validation schema           │
│  - Run the strategy's own middleware              │
│                                                   │
│  Constructor: ({ llmName }, callManagerStrategy)   │
└──────────────────────┬───────────────────────────┘
                       │ delegates calls to
┌──────────────────────▼───────────────────────────┐
│  NativeCallManagerStrategy                        │
│                                                   │
│  Wraps a GenerateCallManager to implement the     │
│  Strategy.CallManager interface.                  │
│  Handles: request prioritization                  │
│                                                   │
│  Import: @moc-global/loft-definitions             │
└──────────────────────┬───────────────────────────┘
                       │ delegates to
┌──────────────────────▼───────────────────────────┐
│  GenerateCallManager                              │
│                                                   │
│  Handles: rate limiting (p-queue), retries with   │
│  backoff (retryDelay), token counting             │
│                                                   │
│  Import: @moc-global/loft-llm-call-manager        │
└──────────────────────┬───────────────────────────┘
                       │ delegates to
┌──────────────────────▼───────────────────────────┐
│  CallStrategy (e.g., OpenAiCallStrategy)          │
│                                                   │
│  Makes the actual HTTP call to the LLM API.       │
│  Implements Strategy.LLM.LLMApi:                  │
│  - generate<Req, Res>(request, options?)          │
│    (streams when options.onEvent is set)          │
│  - tokenRateLimiter: LlmTokenRateLimiter          │
│  - llmTokenizer: LlmTokenizer                     │
└──────────────────────────────────────────────────┘
```

### Available LLM Strategies

| Package | Strategy Class | Call Strategy Class | Provider |
|---------|---------------|-------------------|----------|
| `@moc-global/loft-openai-strategy` | `OpenAiLoftStrategy` | `OpenAiCallStrategy` | OpenAI |
| `@moc-global/loft-openai-strategy` | `AzureOpenAiLoftStrategy` | `AzureOpenAiCallStrategy` | Azure OpenAI |
| `@moc-global/loft-anthropic-strategy` | `AnthropicLoftStrategy` | `AnthropicCallStrategy` | Anthropic Claude |
| `@moc-global/loft-gemini-strategy` | (Gemini strategy) | (Gemini call strategy) | Google Gemini / Vertex AI |

### Composition vs Inheritance

OpenAI and Gemini strategies use `extends AbstractLoftLLM` (inheritance). Anthropic uses composition with an internal `baseStrategy` field instead — this is a workaround for TypeScript generic type recursion issues with the Anthropic SDK types.

Both approaches implement the same interface. The difference is internal only.

### Registration

Strategies are registered on `LoftConstructor` by name. The name must match a key in your manifest JSON:

```typescript
await loftConstructor.registerLlmStrategy('gpt-4o-mini', openAiStrategy);
```

This calls `LlmManager.use()`, which:
1. Registers the strategy's model preset Zod schema with `ManifestManager`
2. Stores the strategy in a `Map<string, LoftLLM>`

At runtime, `LlmManager.generate()` looks up the strategy by name (from the session's `currentLlmName` or a temporary override).

## Manifest Storage Strategies

The `ObjectStorage` interface is used exclusively for **manifest file storage** — the JSON files containing system prompts, model presets, and AI task definitions. This is separate from session and chat history storage (see [Repository Strategies](#repository-strategies) below).

### The ObjectStorage Interface

```typescript
// packages/loft-definitions/src/repositories/ObjectStorage.ts
export interface ObjectStorage {
  get(filePath: string): Promise<Record<string, any>>;
  upload(filePath: string, data: Record<string, any>): Promise<void>;
  remove(filePath: string): Promise<void>;
  checkHealth(): Promise<boolean>;
}
```

### Available Implementations

| Package | Constructor Class | Backend |
|---------|------------------|---------|
| `@moc-global/loft` | `FsRepositoryConstructor()` | Local filesystem (reads/writes JSON files relative to `process.cwd()`) |
| `@moc-global/loft-aws-s3-repository` | `AwsS3RepositoryConstructor({ region, bucketName })` | AWS S3 |
| `@moc-global/loft-gcp-storage-repository` | `GcpStorageRepositoryConstructor(config)` | Google Cloud Storage |
| `@moc-global/loft-azure-blob-storage-repository` | `AzureBlobStorageRepositoryConstructor(config)` | Azure Blob Storage |

All constructors implement `BaseComponentConstructor<ObjectStorage>` and are passed to `ManifestManagerConstructor`:

```typescript
const manifestRepository = new FsRepositoryConstructor(); // or AwsS3RepositoryConstructor, etc.
const manifestManagerConstructor = new ManifestManagerConstructor(manifestRepository, {
  manifestPath: 'manifest/manifest.json',
  errorPath: 'manifest/errors/error.json',
  cacheExpirationTime: 3600000
});
```

## Repository Strategies

### Session Repository

```typescript
// packages/loft-definitions/src/repositories/Session.ts
export interface Session {
  create(newSession: CreateSession): Promise<Session>;
  getById(sessionId: string): Promise<Session>;
  getByExternalKey(externalKey: Record<string, string | number | boolean>): Promise<Session>;
  updateById(sessionId: string, newSession: Partial<Session>): Promise<Session>;
  deleteById(sessionId: string): Promise<void>;
  checkHealth(): Promise<boolean>;
  end(): Promise<void>;
}
```

The out-of-the-box implementation is `@moc-global/loft-session-pg-repository` (Kysely ORM with PostgreSQL). However, this interface is database-agnostic — you can implement it for any storage backend (e.g., MySQL, MongoDB, DynamoDB, or an in-memory store for testing). Your custom implementation must satisfy the `Repository.Session` contract and be wrapped in a `BaseComponentConstructor<Repository.Session>` to integrate with `ChatConstructor`. Throw `SessionNotFoundError` from `getById()`, `getByExternalKey()`, `updateById()` and `deleteById()` for a missing session, so applications can answer 404 (see [Missing Sessions](../guides/error-handling.md#missing-sessions)).

### ChatHistory Repository

```typescript
// packages/loft-definitions/src/repositories/ChatHistory.ts
export interface ChatHistory {
  addMessages(sessionId: string, messages: CreateMessage[]): Promise<Message[]>;
  // With options.limit: only the latest messages, at most that many, still in chronological order
  getMessages(sessionId: string, options?: { limit?: number }): Promise<Message[]>;
  checkHealth(): Promise<boolean>;
  end(): Promise<void>;
}
```

A repository that ignores `limit` still works: the chat history manager keeps the latest messages itself, but the database then reads the whole history.

The out-of-the-box implementation is `@moc-global/loft-chat-history-pg-repository` (Kysely ORM with PostgreSQL). Like `Session`, this interface is database-agnostic and can be implemented for any storage backend.

### ChatHistoryManager

The `ChatHistoryManager` interface combines `ChatHistory` and `ChatHistoryPatcher` capabilities:

```typescript
export interface ChatHistoryManager extends ChatHistory {
  patchMessages(sessionId: string, messages: Message[], patchData: Partial<CreateMessagePatch>): Promise<Message[]>;
}
```

This is the interface that `BaseLoftChat` uses internally for all message operations.

## Call Manager Strategies

The call manager controls how LLM API calls are executed:

### Strategy.CallManager Interface

```typescript
interface CallManager {
  // options: the abort signal and, when the chat streams, the event sink (onEvent)
  call(llmRequest: LLMRequest<any>, options?: CallOptions): Promise<LlmResponse<any>>;
  /** @deprecated Use chat.generate({ onEvent }) instead. Removed in the next major release. */
  streamCall(llmRequest: LLMRequest<any>): Promise<any>;
  getHealthCheckStatus(): Promise<boolean>;
  stop?(): void;                     // Stops background timers; called on shutdown
}
```

A call manager passes `options` on to the provider's `generate()`. One that drops `onEvent` still works: the chat's events arrive, and each step's text comes in one piece after the call. `HttpCallManagerStrategy` sends only the signal, so its calls never stream.

### Available Implementations

| Class | Import | Description |
|-------|--------|-------------|
| `NativeCallManagerStrategy` | `@moc-global/loft-definitions` | Wraps a `GenerateCallManager` for in-process execution. This is the standard choice. |
| `HttpCallManagerStrategy` | `@moc-global/loft-definitions` | Delegates to an external HTTP call manager service. For distributed architectures where call management runs as a separate microservice. **Incomplete — see note below.** |

> **Note on `HttpCallManagerStrategy`:** This adapter exists as a client-side HTTP proxy but is not yet production-ready. The corresponding server-side service (`loft-llm-call-manager-service`) is not included in this monorepo, there are no active tests or integration examples (all existing references are commented out), and the request/response contract is not formally specified. If you need distributed call management, you will need to implement the server side yourself against the `CallManager` interface. This feature requires further refinement before it can be reliably documented or recommended for production use.

> **Note on `generateQueued()` and SQS Queue Strategy:** The `generateQueued()` method on `LoftLLM` and the `SQSStrategy` package (`@moc-global/loft-queue-sqs-strategy`) provide infrastructure for deferred/asynchronous LLM request processing via AWS SQS. The core components (`SQSStrategy`, `GenerateWithQueueManager`, `LlmManager.generateQueued()`) are implemented and the SQS adapter is tested against LocalStack. However, the orchestration layer (`QueuedLoft`, `QueuedLoftConstructor`) is entirely commented out, `generateQueued()` is not exposed on the public `ChatInterface`, and all integration examples are inactive. This feature requires further refinement before it can be used by consumers.

### GenerateCallManager

The `GenerateCallManager` (from `@moc-global/loft-llm-call-manager`) handles the actual call management:

- **Priority queuing** via `p-queue` (one call at a time by default; `concurrency` raises it)
- **Token reservation**: the predicted tokens are taken from the rate limiter before the call and settled to the actual usage after it (`reserveTokens`, on by default)
- **Retry with backoff** on 408, 429, 5xx, network failures and status-less stream errors of type `overloaded_error`, `api_error` or `server_error` (configurable `retryDelay` and `retryAttemptsLimit`)
- **High-priority task limit** to prevent queue saturation
- **Streamed calls** (experimental): a `request-start` event before each attempt, no retry once an event reached the caller, and the `streamIdleTimeoutMs` (default 60 s) and `streamFirstEventTimeoutMs` (default 10 minutes) timeouts; see [Streaming](../guides/streaming.md#retries-timeouts-and-concurrency)

```typescript
const callManager = new GenerateCallManager<OpenAiRequest, OpenAiResponse>(
  'gpt-4o-mini',                          // name (for logging)
  {
    highPriorityTasksLimit: 10,            // max high-priority tasks waiting in the queue
    retryDelay: 1000,                      // backoff base in ms, doubled for each retry
    retryAttemptsLimit: 3,                 // max attempts, the first one included
    concurrency: 1,                        // optional: calls of this model at once (default 1)
    reserveTokens: true,                   // optional: reserve tokens before the call (default true)
    streamIdleTimeoutMs: 60_000            // optional: silence allowed between stream events (default 60000, 0 off)
  },
  openAiCallStrategy                       // the actual API caller
);
```

## Tracer Strategy

Observability is pluggable via `Strategy.Tracer.TracerFactory`:

| Implementation | Description |
|---------------|-------------|
| `NoOpTracerStrategy` (default) | Does nothing — no tracing overhead |
| `LangfuseTracer` | Sends traces to [Langfuse](https://langfuse.com/) for LLM observability |
| Custom | Implement `TracerFactory` interface for your own tracing backend |

Passed to `LoftConstructor`:

```typescript
import { LangfuseTracer } from '@moc-global/loft';

const loftConstructor = new LoftConstructor(
  config,
  manifestManagerConstructor,
  chatConstructor,
  new LangfuseTracer({ secretKey: '...', publicKey: '...', baseUrl: 'https://langfuse.example.com' })
);
```

## Creating Custom Strategies

To add a new LLM provider, you need:

1. A **CallStrategy** class implementing `Strategy.LLM.LLMApi` — makes HTTP calls
2. A **LoftStrategy** class extending `AbstractLoftLLM` — handles message format conversion
3. Registration via `loftConstructor.registerLlmStrategy(name, strategy)`

To add a new manifest storage backend, you need:

1. A class implementing `Repository.ObjectStorage` — `get`, `upload`, `remove`, `checkHealth`
2. A constructor class extending `BaseComponentConstructor<Repository.ObjectStorage>`
3. Pass it to `ManifestManagerConstructor`

To add a custom session or chat history storage backend (e.g., for a non-PostgreSQL database), you need:

1. A class implementing `Repository.Session` or `Repository.ChatHistory` (from `@moc-global/loft-definitions`)
2. A constructor class extending `BaseComponentConstructor<Repository.Session>` or `BaseComponentConstructor<Repository.ChatHistory>`
3. Pass your constructors to `ChatConstructor` in place of the PostgreSQL ones

## Supporting Streaming in a Provider Strategy

A provider strategy streams inside the `generate(request, options)` it already has; there is no separate method. When a chat call passes `onEvent`, LOFT gives the call strategy an event sink in `options.onEvent`. A strategy that ignores it still works: the chat's events arrive, and each step's text is sent in one piece after the call. This part of the contract is experimental.

```typescript
// packages/loft-definitions/src/strategies/llm/LlmStreamEvent.ts
type LlmStreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'reasoning-delta'; delta: string }
  | { type: 'usage'; usage: Partial<StreamUsage> }  // running totals: a later value replaces an earlier one
  | { type: 'activity' }                             // a non-empty chunk whose content is kept back
  | { type: 'request-start' };                       // sent by the call manager before each attempt, never by a provider

type LlmStreamSink = (event: LlmStreamEvent) => boolean | void;
```

The rules a streaming strategy follows (the OpenAI, Anthropic and Gemini strategies are the reference, in their `streaming/` directories):

1. **The same result.** With `onEvent`, `generate()` resolves with a value of the same type and meaning as without it, so `formatToUnifiedLLMResponse` and `extractUsedTokens` work unchanged. Build it from the chunks with an accumulator. A request whose streamed result could differ is sent without streaming: the OpenAI strategies do not stream a `json_schema` response format or a `strict` tool.
2. **Honour the signal.** Pass `options.signal` to the SDK. An aborted call rejects as it does without streaming, also when the last chunk had already arrived.
3. **Ask for the usage** in the stream where the API needs that (OpenAI's `stream_options.include_usage`), and send it as `usage` events. Each `usage` event is a running total for the request so far; never send increments.
4. **Nothing private leaves.** Send only the answer's text as `text-delta` and its reasoning as `reasoning-delta`, and only for the first choice or candidate. Never send tool-call arguments, reasoning signatures, raw chunks or the text of other choices.
5. **Empty chunks.** Skip empty deltas. Send one `activity` for each non-empty chunk whose content rule 4 keeps back, so the call manager's idle timeout knows the stream is alive. A chunk with only usage sends only `usage`. A `usage` event does not start the call manager's idle timer and does not end its first-event timer, so a provider that reports usage at the start of a stream does not hide a long silent wait; the first text, reasoning or `activity` does start it.
6. **Errors.** An error in the middle of the stream rejects with the SDK's error, as a failed request would, so the call manager's retry policy and the chat's error codes see the same error. A stream that ends before the reply is complete (before the provider's completion marker, or inside an event) rejects with a retryable connection-type error (when the SDK raised an error, it is the `cause`): the built-in strategies use `APIConnectionError` for OpenAI and Anthropic and a 502 `ApiError` that says no HTTP error occurred for Gemini. A strategy may resolve with what arrived when every choice had already finished and only the tail was cut, as the OpenAI and Gemini strategies do.
7. **A sink that throws** must not break the stream: catch it and go on building the result. Never log the deltas, arguments or chunks; log a failed stream's error class, status, `type` and `code`, not its message.
8. **Let users opt out** with a constructor option, as the built-in strategies' `streaming: false` does.

The sink's return value tells the call manager whether the event reached the chat's caller; once one did, the call is not retried. Test a strategy against recorded streams: the built-in strategies replay captured provider streams from `src/__tests__/fixtures/stream/` and compare what they build with the expected final response, and the events they send with the expected text.

`LLMApi.generateStream` and `extractContentFromChunk` are deprecated but stay required members until the next major release; a new strategy may implement them by throwing.

## See It in Action

The example applications demonstrate strategy wiring in complete, runnable projects:

- **[express-basic](../../examples/express-basic/)** — OpenAI strategy + `NativeCallManagerStrategy` + `FsRepositoryConstructor`
- **[express-full](../../examples/express-full/)** — Anthropic strategy + Docker PostgreSQL storage

## What's Next

- **[Dependency Injection](./dependency-injection.md)** — How strategies are wired into the DI container
- **[Processing Pipeline](./processing-pipeline.md)** — How strategies are called during request processing
- **[Packages Reference](../reference/packages.md)** — All strategy packages with exports
