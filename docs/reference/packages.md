# Packages Reference

The LOFT monorepo contains 18 packages (in `packages/`) plus an integration test suite (in `integration/`). This page lists every package with its npm name, directory, version, purpose, and key exports.

## Choosing Packages

LOFT is modular — you install only what you need:

**Always required:**
- `@moc-global/loft` — Core framework
- `@moc-global/loft-definitions` — Types and interfaces

**Pick one LLM provider:**
- `@moc-global/loft-openai-strategy` — OpenAI / Azure OpenAI
- `@moc-global/loft-anthropic-strategy` — Anthropic Claude
- `@moc-global/loft-gemini-strategy` — Google Gemini / Vertex AI

**Pick one manifest storage (or use built-in local FS):**
- Built-in `FsRepositoryConstructor` — Local filesystem (from `@moc-global/loft`)
- `@moc-global/loft-aws-s3-repository` — AWS S3
- `@moc-global/loft-gcp-storage-repository` — Google Cloud Storage
- `@moc-global/loft-azure-blob-storage-repository` — Azure Blob Storage

**For chat persistence (optional but typical):**
- `@moc-global/loft-session-pg-repository` — PostgreSQL session storage
- `@moc-global/loft-chat-history-pg-repository` — PostgreSQL chat history

**For multi-agent workflows (optional):**
- `@moc-global/loft-agents` — Orchestrator, Focus, Teams, retry/timeout policies

**For rate limiting (recommended):**
- `@moc-global/loft-llm-call-manager` — Rate limiting, retry, token counting

## Published Packages

### Core Framework

#### `@moc-global/loft`

| | |
|---|---|
| **Directory** | `packages/loft/` |
| **Purpose** | Core framework: constructors, managers, workflows |
| **Key exports** | `LoftConstructor`, `ChatConstructor`, `ManifestManagerConstructor`, `FsRepositoryConstructor`, `LOFT`, `LlmManager`, `ManifestManager`, `ChatHistoryManager`, `MCPManager`, `ToolInterceptorManager`, `BaseLoftChat`, `LangfuseTracer`, `NoOpTracerStrategy`, `LlmContextWindowCropper`, `FocusRegistry`, `computeFocusStatus`, `generateFocusPrompt`, `generateFocusTools`, `InMemoryFocusStateStore`, `coerceValue`, `validateField` |
| **Peer deps** | `@moc-global/loft-definitions`, `inversify` 6, `reflect-metadata`, `zod` 4, `@modelcontextprotocol/sdk`; `langfuse` 3 (optional, for `LangfuseTracer`) |

#### `@moc-global/loft-definitions`

| | |
|---|---|
| **Directory** | `packages/loft-definitions/` |
| **Purpose** | Foundation: all types, interfaces, DI symbols, Logger, Zod schemas |
| **Key exports** | `DI_TYPES`, `Interface.*`, `Strategy.*`, `Type.*`, `Repository.*`, `Schema.*`, `Chat.*`, `Logger`, `PinoLoggerStrategy`, `NativeCallManagerStrategy`, `HttpCallManagerStrategy`, `InteractiveOutputMessage` |
| **CLI** | `log-format` — pipe LOFT JSON log output through this for readable formatting |
| **Note** | Every other LOFT package depends on this. `HttpCallManagerStrategy` is exported but incomplete — it requires an external server not included in this monorepo (see [Strategy Pattern](../concepts/strategy-pattern.md#available-implementations)). |

### LLM Strategies

#### `@moc-global/loft-openai-strategy`

| | |
|---|---|
| **Directory** | `packages/loft-openai-strategy/` |
| **Purpose** | OpenAI and Azure OpenAI LLM integration |
| **Key exports** | `OpenAiLoftStrategy`, `AzureOpenAiLoftStrategy`, `OpenAiCallStrategy`, `AzureOpenAiCallStrategy`, `AzureOpenAiConfig`, `OpenAiStrategyOptions`, `OpenAiRequest`, `OpenAiResponse`, `OpenAiLlm` (the `openai` module), `OpenAiValidatingSchemas`, `OpenAiRequestBodySchema`, `mcpToOpenAITool` |
| **External deps** | `openai`, `@azure/identity` |

#### `@moc-global/loft-anthropic-strategy`

| | |
|---|---|
| **Directory** | `packages/loft-anthropic-strategy/` |
| **Purpose** | Anthropic Claude LLM integration |
| **Key exports** | `AnthropicLoftStrategy`, `AnthropicCallStrategy`, `AnthropicStrategyOptions`, `AnthropicRequest`, `AnthropicResponse`, `MessageCreateParamsSchema` |
| **External deps** | `@anthropic-ai/sdk` |

#### `@moc-global/loft-gemini-strategy`

| | |
|---|---|
| **Directory** | `packages/loft-gemini-strategy/` |
| **Purpose** | Google Gemini / Vertex AI LLM integration |
| **Key exports** | `GeminiLoftStrategy`, `GeminiCallStrategy`, `GeminiStrategyOptions`, `GeminiStrategyConfig` (`VertexAiCallStrategyConfig` is its deprecated alias), `GeminiRequest`, `GeminiResponse`, `GeminiValidatingSchema`, `GeminiRequestBodySchema`; `GeminiStream` is deprecated (use `chat.generate({ onEvent })`) |
| **External deps** | `@google/genai` |

### Agent Orchestration

#### `@moc-global/loft-agents`

| | |
|---|---|
| **Directory** | `packages/loft-agents/` |
| **Purpose** | Multi-agent orchestration layer on top of LOFT — compose specialized agents into sequential, parallel, and hierarchical workflows |
| **Key exports** | `LoftAgentNode`, `Orchestrator`, `OrchestratorBuilder`, `SharedContext`, `TeamBuilder`, `TeamNode` (Focus re-exported from `@moc-global/loft`) |
| **Peer deps** | `@moc-global/loft`, `@moc-global/loft-definitions` |
| **Concepts** | [Agent Orchestration](../concepts/agents/README.md) |
| **Example** | [express-agents](../../examples/express-agents/) — Restaurant Agent Showcase with Focus, FAN_OUT, Teams |
| **ADRs** | [loft-agents ADRs](../adr/loft-agents/README.md) |

### Call Management

#### `@moc-global/loft-llm-call-manager`

| | |
|---|---|
| **Directory** | `packages/loft-llm-call-manager/` |
| **Purpose** | Rate limiting with token reservation, retries with backoff, token counting, request prioritization, configurable concurrency, stream timeouts |
| **Key exports** | `GenerateCallManager`, `GenerateWithQueueManager`, `LlmTokenizer`, `LlmTokenRateLimiter`; `GenerateWithStreamManager` is deprecated (use `chat.generate({ onEvent })`) |
| **External deps** | `p-queue`, `@dqbd/tiktoken` |

### Database Repositories

#### `@moc-global/loft-session-pg-repository`

| | |
|---|---|
| **Directory** | `packages/loft-session-pg-repository/` |
| **Purpose** | PostgreSQL session storage via Kysely ORM |
| **Key exports** | `SessionRepositoryConstructor`, `SessionPostgresDialect`, `runSessionPgMigrations`, `FocusStateStorePg` |
| **CLI** | `loft-session-pg-migrate` — run database migrations (`to-latest`, `down`, etc.) |
| **External deps** | `kysely`, `pg` |

#### `@moc-global/loft-chat-history-pg-repository`

| | |
|---|---|
| **Directory** | `packages/loft-chat-history-pg-repository/` |
| **Purpose** | PostgreSQL chat history storage via Kysely ORM |
| **Key exports** | `ChatHistoryRepositoryConstructor`, `ChatHistoryPostgresDialect`, `runChatHistoryPgMigrations` |
| **CLI** | `loft-chat-history-pg-migrate` — run database migrations |
| **External deps** | `kysely`, `pg` |

### Object Storage

#### `@moc-global/loft-aws-s3-repository`

| | |
|---|---|
| **Directory** | `packages/loft-manifest-s3-strategy/` |
| **Purpose** | AWS S3 manifest storage |
| **Key exports** | `AwsS3RepositoryConstructor` |
| **External deps** | `@aws-sdk/client-s3` |
| **Note** | npm name differs from directory name |

#### `@moc-global/loft-gcp-storage-repository`

| | |
|---|---|
| **Directory** | `packages/loft-manifest-gcp-storage-repository/` |
| **Purpose** | Google Cloud Storage manifest storage |
| **Key exports** | `GcpStorageRepositoryConstructor` |
| **External deps** | `@google-cloud/storage` |
| **Note** | npm name differs from directory name |

#### `@moc-global/loft-azure-blob-storage-repository`

| | |
|---|---|
| **Directory** | `packages/loft-azure-blob-repository/` |
| **Purpose** | Azure Blob Storage manifest storage |
| **Key exports** | `AzureBlobStorageRepositoryConstructor` |
| **External deps** | `@azure/storage-blob` |
| **Note** | npm name differs from directory name |

### Queue

#### `@moc-global/loft-queue-sqs-strategy`

| | |
|---|---|
| **Directory** | `packages/loft-queue-sqs-strategy/` |
| **Purpose** | AWS SQS queue for distributed/deferred LLM request processing |
| **Key exports** | `SQSStrategy` |
| **External deps** | `@aws-sdk/client-sqs`, `sqs-consumer` |
| **Note** | Incomplete — `SQSStrategy` and `GenerateWithQueueManager` are implemented, but the orchestration layer (`QueuedLoft`, `QueuedLoftConstructor`) is entirely commented out and `generateQueued()` is not exposed on the public `ChatInterface`. All integration examples are inactive. The underlying infrastructure works but lacks a consumer-facing path. |

## Private Packages (not published to npm)

These packages are not published: most are used for development and testing, and `@moc-global/loft-middleware` stays private until an application adopts it.

#### `@moc-global/loft-base-tsconfig`

| | |
|---|---|
| **Directory** | `packages/loft-base-tsconfig/` |
| **Purpose** | Shared TypeScript configuration: ES2022, strict mode, `experimentalDecorators` + `emitDecoratorMetadata` (required for Inversify) |

#### `@moc-global/loft-pglite`

| | |
|---|---|
| **Directory** | `packages/loft-pglite/` |
| **Purpose** | In-process PostgreSQL for unit tests (no Docker required) |
| **Key exports** | `PGLiteInstanceFactory`, `PGLiteUtils`, `PortManager` |
| **Limitation** | Max 1 concurrent connection per PGLite instance |

#### `@moc-global/loft-test-suite`

| | |
|---|---|
| **Directory** | `packages/loft-test-suite/` |
| **Purpose** | Test utilities: mock and spy logger strategies, the scripted LLM, repository contract suites and tool-call fixtures |
| **Key exports** | `configureMockLoggerStrategy`, `configureSpyLoggerStrategy`, `ScriptedLLMStrategy`, `ScriptedLLMApi`, `testSessionRepository`, `testChatHistoryRepository`, `toolChainFixtures`, `mcpTools` |

#### `@moc-global/loft-middleware`

| | |
|---|---|
| **Directory** | `packages/loft-middleware/` |
| **Purpose** | Guard middleware: PII redaction and prompt-injection detection across requests, tool outputs and traces (experimental, not yet published) |
| **Key exports** | `applyMiddleware`, `maskTracerFactory`, `maskTracer`, `guardMcpClient`, `guardTool`, `guardTools`; `/pii`: `piiRedaction` and detectors; `/injection`: `injectionGuard`, `heuristicDetector`, `findInjectionDetected` |
| **Guide** | [Guard middleware](../guides/guard-middleware.md) |

#### `@moc-global/loft-kysely-pg-migrator`

| | |
|---|---|
| **Directory** | `packages/loft-kysely-pg-migrator/` |
| **Purpose** | Shared Kysely PostgreSQL migration infrastructure |
| **Key exports** | `BaseMigrator`, `createCLI` |
| **Used by** | `loft-session-pg-repository`, `loft-chat-history-pg-repository` |

#### `loft-integration-tests`

| | |
|---|---|
| **Directory** | `integration/` |
| **Purpose** | End-to-end integration tests |
| **Note** | Uses PGLite for database tests (no Docker required for main suite) |

## Directory-to-npm Name Mismatches

Three packages have npm names that differ from their directory:

| Directory | npm Package |
|-----------|-------------|
| `packages/loft-manifest-s3-strategy/` | `@moc-global/loft-aws-s3-repository` |
| `packages/loft-manifest-gcp-storage-repository/` | `@moc-global/loft-gcp-storage-repository` |
| `packages/loft-azure-blob-repository/` | `@moc-global/loft-azure-blob-storage-repository` |

When using `pnpm --filter` or `turbo --filter`, both directory name and npm name work.

## Example Packages (private, not published)

The `examples/` directory contains runnable reference applications. Each is a private workspace package (`"private": true`) excluded from Changesets publishing.

| Package | Directory | Demonstrates |
|---------|-----------|-------------|
| `@moc-global/example-express-basic` | `examples/express-basic/` | Stateless single-turn chat (OpenAI, PGLite) |
| `@moc-global/example-express-history` | `examples/express-history/` | Multi-turn conversations (OpenAI, PGLite) |
| `@moc-global/example-express-full` | `examples/express-full/` | Middleware, GM Computer, Anthropic, Docker PG |
| `@moc-global/example-express-focus-basic` | `examples/express-focus-basic/` | Focus without agents: a pizza order collected over several turns (Anthropic, Docker PG) |
| `@moc-global/example-express-agents` | `examples/express-agents/` | Multi-agent orchestration: Focus, FAN_OUT, Teams, Anthropic, Docker PG |
| `@moc-global/example-nestjs` | `examples/nestjs/` | NestJS module integration (OpenAI, PGLite) |
| `@moc-global/example-serverless` | `examples/serverless/` | AWS Lambda handler with cold-start caching |
| `@moc-global/example-middleware` | `examples/middleware/` | Middleware recipes, and the guard middleware in an offline demo |

See [examples/README](../../examples/README.md) for setup instructions.

## Pinned Dependencies

The following dependency versions are pinned across all packages:

| Package | Pinned Version | Reason |
|---------|---------------|--------|
| `zod` | `4.6.7` (exact, in development); `^4.6.6` for users (peer) | One Zod copy in the workspace, so schemas from different packages are compatible; 4.6.6 is the first version without the GHSA-mrhx-c7xc-m3w5 memory exhaustion |
| `@modelcontextprotocol/sdk` | `^1.31.0` (peer) | MCP protocol compatibility |

## Supported Provider SDK Versions

The LLM and queue strategies take their provider SDK as a peer dependency, so your application and LOFT share one copy. Install a version in the supported range; npm 7 and later refuse to install a version outside it.

| Package | Peer dependency | Supported range | Note |
|---------|-----------------|-----------------|------|
| `@moc-global/loft-openai-strategy` | `openai` | `^7.34.0` | openai 4 and 5 need zod 3; openai 6 is not tested |
| `@moc-global/loft-anthropic-strategy` | `@anthropic-ai/sdk` | `>=0.39.0 <1` | Every 0.x release from 0.39.0; tested with 0.39.0 and 0.134.0 |
| `@moc-global/loft-gemini-strategy` | `@google/genai` | `^1.30.0 \|\| ^2.30.0` | |
| `@moc-global/loft-queue-sqs-strategy` | `@aws-sdk/client-sqs` | `^3.1140.0` | |
| All packages with Zod schemas | `zod` | `^4.6.6` | Zod 3 is not supported |

LOFT is built and CI-tested with the newest version of each range. The oldest and newest version of each range were tested when the range was last changed.
