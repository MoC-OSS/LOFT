# Configuration Types Reference

This page documents all TypeScript configuration types used when initializing LOFT. These are the shapes you pass to constructors — not environment variables (see [Environment Variables](./environment-variables.md) for those).

## LoftConstructor Configuration

### LoftConfig

```typescript
// packages/loft/src/types/config.ts
interface LoftConfig {
  logLevel?: Interface.LogLevel;   // Optional. Default: LogLevel.INFO (30)
}
```

Passed as the first argument to `LoftConstructor`:

```typescript
import { Interface } from '@moc-global/loft-definitions';

const loftConstructor = new LoftConstructor(
  { logLevel: Interface.LogLevel.DEBUG },   // LoftConfig
  manifestManagerConstructor,
  chatConstructor
);
```

### LogLevel Enum

```typescript
// packages/loft-definitions/src/interfaces/Logger.ts
enum LogLevel {
  NONE  = 100,    // No logging
  FATAL = 60,     // Fatal errors only
  ERROR = 50,     // Errors
  WARN  = 40,     // Warnings
  INFO  = 30,     // Informational (default)
  DEBUG = 20,     // Debug details
  TRACE = 10      // Everything including trace
}
```

### What each level logs

LOFT keeps chat content out of the default logs. Prompts, user messages, tool arguments and tool results are logged only at `DEBUG` and `TRACE`, so turn those levels on only where the logs may hold user data.

| Level | What LOFT logs |
| --- | --- |
| `ERROR` / `FATAL` | Failures with their error message, stack, session id and counts. HTTP client errors are logged without their request (body and headers); the HTTP status is kept. |
| `WARN` | Recoverable problems: a tool that is missing or returned an invalid result, a cache refresh that failed, a cropped context window with an incomplete tool chain. Tool names and ids only, no content. |
| `INFO` (default) | Lifecycle and progress: LLM requests sent and completed, tool names called and their result counts, shutdown. No content. |
| `DEBUG` | Adds tool arguments, tool results, failed tool results and the steps of the tool loop. **May contain user data.** |
| `TRACE` | Adds per-call details such as the tool calls the LLM requested. **May contain user data.** |

At every level, the default `PinoLoggerStrategy` replaces credentials with `[Redacted]`: the `authorization`, `apiKey`, `api_key`, `password`, `token`, `accessToken` and `secret` fields, and the `authorization`, `x-api-key`, `api-key` and `cookie` headers (lower-case or capitalised) of a logged object. A custom `LoggerStrategy` must do its own redaction.

## ChatConstructor Configuration

### ChatConfig

```typescript
// packages/loft/src/types/config.ts
interface ChatConfig {
  shutdownTimeout?: number;          // Max wait of shutdown() for active operations, in ms (>= 0). Default: no limit
  historyLimit?: number;             // Latest history messages a request loads (integer >= 0). Default: all
  mcp?: {
    toolCacheTtl?: number;           // MCP tool list cache TTL in ms. Default: 60000 (1 min)
    maxCallsPerGenerate?: number;    // Max MCP tool execution loop iterations. Default: 10
  };
  streaming?: Chat.StreamOptions;    // Experimental. Defaults of every generate() call that passes onEvent
}
```

`streaming` sets the defaults of [streamed](../guides/streaming.md) calls. A call's `streamOptions` are merged over them, key by key:

```typescript
// packages/loft-definitions/src/shared/components/ChatStreamEvent.ts
interface StreamOptions {
  enabled?: boolean;                 // false: observe-only, the providers do not stream. Default: true
  include?: {
    reasoning?: boolean;             // Send reasoning-delta events. Default: false
    toolCalls?: 'none' | 'names' | 'args';  // Tool events, and whether tool-call carries the arguments. Default: 'names'
  };
  textPolicy?: 'all' | 'after-middleware';  // Default: 'after-middleware' when output-transforming middleware is registered, else 'all'
}
```

Passed as the fifth argument to `ChatConstructor`:

```typescript
const chatConstructor = new ChatConstructor(
  sessionRepoConstructor,              // required
  chatHistoryRepoConstructor,          // required
  undefined,                           // chatHistoryPatcherRepoConstructor (optional)
  undefined,                           // llmContextWindowCropper (optional)
  { mcp: { toolCacheTtl: 120000, maxCallsPerGenerate: 15 } }  // ChatConfig (optional)
);
```

### Full ChatConstructor Signature

```typescript
class ChatConstructor extends BaseComponentConstructor<BaseLoftChat> {
  constructor(
    sessionRepositoryConstructor: BaseComponentConstructor<Repository.Session>,
    chatHistoryRepositoryConstructor: BaseComponentConstructor<Repository.ChatHistory>,
    chatHistoryPatcherRepositoryConstructor?: BaseComponentConstructor<Repository.ChatHistoryPatcher>,
    llmContextWindowCropper?: Strategy.LlmContextWindowCropper,
    chatConfig?: ChatConfig
  )
}
```

## ManifestManagerConstructor Configuration

### ManifestManagerConfig

```typescript
// packages/loft-definitions/src/interfaces/ManifestManager.ts
interface ManifestManagerConfig {
  manifestPath: string;           // Path to manifest file (include filename)
  errorPath: string;              // Path to error manifest file (include filename)
  cacheExpirationTime: number;    // Cache TTL in milliseconds
}
```

```typescript
const manifestManagerConstructor = new ManifestManagerConstructor(
  manifestRepositoryConstructor,       // FsRepositoryConstructor, AwsS3RepositoryConstructor, etc.
  {
    manifestPath: 'manifest/manifest.json',
    errorPath: 'manifest/errors/error.json',
    cacheExpirationTime: 3600000       // 1 hour
  }
);
```

## Repository Configurations

### SessionRepositoryConstructor

```typescript
// Constructor signature
new SessionRepositoryConstructor(
  dialect: SessionPostgresDialect,     // Kysely PostgreSQL dialect
  config: { schema: string }           // Schema name (e.g., 'loft_session')
)

// SessionPostgresDialect wraps a pg Pool
new SessionPostgresDialect({ pool: pgPool })
```

### ChatHistoryRepositoryConstructor

```typescript
// Constructor signature
new ChatHistoryRepositoryConstructor(
  dialect: ChatHistoryPostgresDialect, // Kysely PostgreSQL dialect
  config: { schema: string }           // Schema name (e.g., 'loft_chat_history')
)

new ChatHistoryPostgresDialect({ pool: pgPool })
```

## LLM Call Manager Configuration

### LlmTokenRateLimiterConfig

```typescript
// packages/loft-llm-call-manager/src/LlmTokenRateLimiter.ts
interface LlmTokenRateLimiterConfig {
  newTokensPerSecond: number;       // Token throughput limit
  newRequestsPerSecond: number;     // Request throughput limit
  maxTokens: number;                // Maximum token budget
  maxRequests: number;              // Request budget per time window (refilled at newRequestsPerSecond), not a concurrency limit
  maxAwaitSeconds: number;          // Maximum wait time for rate-limited requests
}
```

### GenerateConfig

```typescript
// packages/loft-llm-call-manager/src/types.ts
interface GenerateConfig {
  highPriorityTasksLimit: number;   // Max high-priority tasks in queue
  retryDelay: number;               // Base of the exponential backoff between retries (ms); Retry-After overrides it
  retryAttemptsLimit: number;       // Attempts per call; only 408, 429, 5xx, network failures and status-less `overloaded_error` / `api_error` / `server_error` errors are retried
  concurrency?: number;             // Calls of this model that run at once in this process; an integer >= 1, otherwise RangeError (default: 1)
  reserveTokens?: boolean;          // Reserve the predicted tokens before the call and settle to the actual usage after it (default: true)
  streamIdleTimeoutMs?: number;     // Experimental. Streamed calls: longest silence between two provider events, in ms, once the first text, reasoning or activity arrived; 0 disables (default: 60000)
  streamFirstEventTimeoutMs?: number; // Experimental. Streamed calls: longest wait for the first provider output (text, reasoning or activity; a usage report does not count), in ms; 0 disables (default: 600000)
}
```

Both stream timeouts take an integer from 0 to 2147483647, or the constructor throws a `RangeError`. They apply only to calls that pass `onEvent` and are not observe-only. A timeout aborts the attempt with `StreamIdleTimeoutError`, which is retried while nothing reached the caller. `streamFirstEventTimeoutMs` also bounds calls the provider answers without streaming (a provider that does not stream, a strategy built with `streaming: false`, an OpenAI request with a JSON schema or strict tools, or a Gemini request with a `candidateCount` above 1), which send no event until the whole answer arrives, so set it above your longest non-streamed answer. A model that thinks silently before its first output is bounded by `streamFirstEventTimeoutMs`: the SDKs' request timeout covers only the wait for the response headers, not the stream, so with it off only the call's `signal` ends such a wait. The queue and the rate limiter are per process, so divide the provider's budgets by the number of instances; see [Streaming](../guides/streaming.md#before-you-serve-more-than-one-user) and [the retry settings](../guides/streaming.md#retries-timeouts-and-concurrency).

### Usage Example

```typescript
import { GenerateCallManager, LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';

const callStrategy = new OpenAiCallStrategy(
  apiKey,
  new LlmTokenRateLimiter({
    newTokensPerSecond: 50000,
    newRequestsPerSecond: 100,
    maxRequests: 500,
    maxTokens: 2000000,
    maxAwaitSeconds: 300
  }),
  new LlmTokenizer()
);

const callManager = new GenerateCallManager<OpenAiRequest, OpenAiResponse>(
  'gpt-4o-mini',
  {
    highPriorityTasksLimit: 10,
    retryDelay: 1000,
    retryAttemptsLimit: 3
  },
  callStrategy
);
```

## Object Storage Configurations

### AWS S3

```typescript
// packages/loft-manifest-s3-strategy/src/AwsS3Repository.ts
interface AwsS3RepositoryConfig {
  region: string;                    // AWS region (e.g., 'us-east-1')
  bucketName: string;                // S3 bucket name
  endpoint?: string;                 // Custom endpoint (e.g., LocalStack)
  forcePathStyle?: boolean;          // Force path-style URLs (for LocalStack)
}
```

```typescript
import { AwsS3RepositoryConstructor } from '@moc-global/loft-aws-s3-repository';

const s3Constructor = new AwsS3RepositoryConstructor({
  region: 'us-east-1',
  bucketName: 'my-manifests'
});
```

### Google Cloud Storage

```typescript
// packages/loft-manifest-gcp-storage-repository/src/GcpStorageRepository.ts
interface GcpStorageRepositoryConfig {
  bucketName: string;                // GCS bucket name
  apiEndpoint?: string;              // Custom endpoint (e.g., fake-gcs-server)
  projectId?: string;                // GCP project ID
}
```

### Azure Blob Storage

```typescript
// packages/loft-azure-blob-repository/src/AzureBlobStorageRepository.ts
interface AzureBlobStorageRepositoryConfig {
  containerName: string;             // Blob container name
  connectionString: string;          // Azure connection string
}
```

## Full LoftConstructor Signature

For reference, the complete `LoftConstructor` signature:

```typescript
class LoftConstructor<
  TChatInterface extends Chat.ChatInterface | Chat.ChatInterfaceWithSMG,
  TLoft extends LOFT<TChatInterface> = LOFT<TChatInterface>
> {
  constructor(
    loftConfig: LoftConfig,
    manifestManagerConstructor: BaseModuleConstructor<ManifestManager>,
    chatConstructor?: ChatConstructorType<TChatInterface>,   // Optional
    tracerStrategy?: Strategy.Tracer.TracerFactory,          // Optional (default: NoOpTracerStrategy)
    logStrategy?: Interface.LoggerStrategy                   // Optional (default: PinoLoggerStrategy)
  )

  // Public methods
  registerLlmStrategy(name: string, strategy: LoftLLM, forceOverwrite?: boolean): Promise<void>
  registerGMComputer(manifestName: string, llmName: string, handler: PromptComputer): void
  registerATMComputer(manifestName: string, llmName: string, handler: PromptComputer): void
  registerPromptComputer(promptName: string, llmName: string, handler: PromptComputer): void
  validateManifest(): Promise<void>
  getInstance(): TLoft
  gracefulShutdown(): Promise<void> // @deprecated: loft.shutdown() shuts the tracer down
}
```

### Parameter Order (critical)

```
1. loftConfig              — { logLevel? }
2. manifestManagerConstructor — ManifestManagerConstructor instance
3. chatConstructor?        — ChatConstructor instance (optional)
4. tracerStrategy?         — TracerFactory (optional, default: NoOp)
5. logStrategy?            — LoggerStrategy (optional, default: Pino)
```
