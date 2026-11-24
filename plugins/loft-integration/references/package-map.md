# LOFT Package Map

## Contents

- Package Selection Guide
- Minimum Viable Install
- Peer Dependencies
- Full Package Catalog
- Directory-to-NPM Name Mismatches
- Package Dependency Graph

All packages in the `@moc-global/loft` monorepo, verified against loft 3.0.0 (`@moc-global/loft` version below). If the installed version differs, check `node_modules/@moc-global/loft/package.json` and confirm via source.

> **Package manager:** Commands below use `npm`. Substitute `yarn add` or `pnpm add` if that's what your project uses. npm 7+ and pnpm install missing peers; with Yarn, list every peer explicitly (as below).

> **Node.js:** 22 or later; 22.12 or later for `loft-llm-call-manager` and the PostgreSQL repositories.

---

## Package Selection Guide

### Always Required

```bash
npm install @moc-global/loft @moc-global/loft-definitions \
  reflect-metadata inversify@^6 zod@^4.6.6 @modelcontextprotocol/sdk
```

### Pick One LLM Provider

Each strategy also needs its provider SDK as a peer.

| Package | Provider | Peer SDK | API Key Format |
|---------|----------|----------|---------------|
| `@moc-global/loft-openai-strategy` | OpenAI; Azure OpenAI | `openai@^7.34.0` | Plain string (`OpenAiCallStrategy(apiKey, ...)`); Azure: config object (`AzureOpenAiCallStrategy(config, ...)`) |
| `@moc-global/loft-anthropic-strategy` | Anthropic Claude | `@anthropic-ai/sdk@">=0.39.0 <1"` | Object (`AnthropicCallStrategy({ apiKey }, ...)`) |
| `@moc-global/loft-gemini-strategy` | Google Gemini via Vertex AI or Google AI Studio | `@google/genai@"^1.30.0 \|\| ^2.30.0"` | Config object (`GeminiCallStrategy({ mode: 'vertexai' \| 'apikey', ... }, ...)`) |

You can register **multiple** strategies at runtime.

### Pick One Manifest Storage

| Package | Backend | Notes |
|---------|---------|-------|
| `FsRepositoryConstructor` (built into `@moc-global/loft`) | Local filesystem | No extra install. Default for dev. |
| `@moc-global/loft-aws-s3-repository` | AWS S3 | Uses AWS SDK credential chain |
| `@moc-global/loft-gcp-storage-repository` | Google Cloud Storage | Uses ADC |
| `@moc-global/loft-azure-blob-storage-repository` | Azure Blob Storage | Uses connection string |

### For Chat Persistence (typical)

```bash
npm install @moc-global/loft-session-pg-repository @moc-global/loft-chat-history-pg-repository pg
```

### For Rate Limiting (effectively required)

Every LLM call strategy constructor takes an `LlmTokenRateLimiter` and an `LlmTokenizer`, and the setup patterns use `GenerateCallManager` — all from this package. While technically you could implement your own, no alternative is provided out of the box.

```bash
npm install @moc-global/loft-llm-call-manager
```

### For Multi-Agent Workflows (optional)

```bash
npm install @moc-global/loft-agents
```

---

## Minimum Viable Install

```bash
npm install @moc-global/loft @moc-global/loft-definitions @moc-global/loft-llm-call-manager \
  @moc-global/loft-openai-strategy \
  @moc-global/loft-session-pg-repository @moc-global/loft-chat-history-pg-repository \
  reflect-metadata inversify@^6 zod@^4.6.6 @modelcontextprotocol/sdk openai@^7 pg
```

For Anthropic or Gemini, swap the strategy package and its SDK (see the provider table).

---

## Peer Dependencies

| Peer | Range | Required by |
|------|-------|-------------|
| `@moc-global/loft-definitions` | matching major | every published package |
| `@moc-global/loft` | matching major | `loft-agents` |
| `inversify` | `^6.2.2` (not 7) | `loft`, `loft-definitions`, PG and manifest repositories |
| `reflect-metadata` | `^0.2.2` | `loft`, PG and manifest repositories |
| `zod` | `^4.6.6` (zod 3 not supported) | `loft`, `loft-definitions`, the three LLM strategies, PG repositories |
| `@modelcontextprotocol/sdk` | `^1.31.0` | `loft`, `loft-definitions`, the three LLM strategies |
| `langfuse` | `^3.38.4` (optional) | `loft`, only when using `LangfuseTracer` |
| `openai` | `^7.34.0` | `loft-openai-strategy` |
| `@anthropic-ai/sdk` | `>=0.39.0 <1` | `loft-anthropic-strategy` |
| `@google/genai` | `^1.30.0 \|\| ^2.30.0` | `loft-gemini-strategy` |
| `@aws-sdk/client-sqs` | `^3.1140.0` | `loft-queue-sqs-strategy` |

---

## Full Package Catalog

### Core

| npm Name | Directory | Version | Purpose | Key Exports |
|----------|-----------|---------|---------|-------------|
| `@moc-global/loft` | `loft/` | 3.0.0 | Core framework: DI bootstrap, chat workflow, middleware pipeline, manifests, MCP, tracing, Focus | `LoftConstructor`, `ChatConstructor`, `ManifestManagerConstructor`, `FsRepositoryConstructor`, `LOFT`, `BaseLoftChat`, `LlmManager`, `ManifestManager`, `LangfuseTracer`, `NoOpTracerStrategy`, `LlmContextWindowCropper`, `FocusRegistry` |
| `@moc-global/loft-definitions` | `loft-definitions/` | 2.0.0 | All types, interfaces, DI symbols, Logger, Zod schemas | `DI_TYPES`, `Interface.*`, `Strategy.*`, `Type.*`, `Repository.*`, `Schema.*`, `Constant.*`, `Util.*`, `Logger`, `PinoLoggerStrategy`, `NativeCallManagerStrategy` (`LogLevel` only as `Interface.LogLevel`) |

`loft-definitions` also ships a `log-format` CLI for readable LOFT JSON logs.

### LLM Strategies

| npm Name | Directory | Version | Key Exports |
|----------|-----------|---------|-------------|
| `@moc-global/loft-openai-strategy` | `loft-openai-strategy/` | 2.0.0 | `OpenAiLoftStrategy`, `OpenAiCallStrategy`, `AzureOpenAiLoftStrategy`, `AzureOpenAiCallStrategy`, `OpenAiRequest`, `OpenAiResponse` |
| `@moc-global/loft-anthropic-strategy` | `loft-anthropic-strategy/` | 2.0.0 | `AnthropicLoftStrategy`, `AnthropicCallStrategy`, `AnthropicRequest`, `AnthropicResponse` |
| `@moc-global/loft-gemini-strategy` | `loft-gemini-strategy/` | 2.0.0 | `GeminiLoftStrategy`, `GeminiCallStrategy`, `GeminiStrategyConfig`; `GeminiStream` is deprecated (use `chat.generate({ onEvent })`) |

### Call Management

| npm Name | Directory | Version | Key Exports |
|----------|-----------|---------|-------------|
| `@moc-global/loft-llm-call-manager` | `loft-llm-call-manager/` | 3.0.0 | `GenerateCallManager`, `GenerateWithQueueManager`, `LlmTokenizer`, `LlmTokenRateLimiter`; `GenerateWithStreamManager` is deprecated (use `chat.generate({ onEvent })`) |

### Agent Orchestration

| npm Name | Directory | Version | Key Exports |
|----------|-----------|---------|-------------|
| `@moc-global/loft-agents` | `loft-agents/` | 2.0.0 | `LoftAgentNode`, `Orchestrator`, `OrchestratorBuilder`, `SharedContext`, `TeamBuilder`, `TeamNode`, `withRetry`, `withTimeout` (Focus helpers re-exported from `@moc-global/loft`) |

### Database Repositories

| npm Name | Directory | Version | Key Exports | CLI |
|----------|-----------|---------|-------------|-----|
| `@moc-global/loft-session-pg-repository` | `loft-session-pg-repository/` | 3.0.0 | `SessionRepositoryConstructor`, `SessionPostgresDialect`, `runSessionPgMigrations`, `FocusStateStorePg` | `loft-session-pg-migrate` |
| `@moc-global/loft-chat-history-pg-repository` | `loft-chat-history-pg-repository/` | 3.0.0 | `ChatHistoryRepositoryConstructor`, `ChatHistoryPostgresDialect`, `runChatHistoryPgMigrations` | `loft-chat-history-pg-migrate` |

### Object Storage (Manifest)

| npm Name | Directory | Version | Key Exports |
|----------|-----------|---------|-------------|
| `@moc-global/loft-aws-s3-repository` | `loft-manifest-s3-strategy/` | 2.0.0 | `AwsS3RepositoryConstructor` |
| `@moc-global/loft-gcp-storage-repository` | `loft-manifest-gcp-storage-repository/` | 2.0.0 | `GcpStorageRepositoryConstructor` |
| `@moc-global/loft-azure-blob-storage-repository` | `loft-azure-blob-repository/` | 2.0.0 | `AzureBlobStorageRepositoryConstructor` |

### Queue

| npm Name | Directory | Version | Key Exports | Status |
|----------|-----------|---------|-------------|--------|
| `@moc-global/loft-queue-sqs-strategy` | `loft-queue-sqs-strategy/` | 2.0.0 | `SQSStrategy`, `SQSClient` | Experimental: the queue works, but no public LOFT method sends work through it |

### Private Packages (not published)

| npm Name | Directory | Purpose |
|----------|-----------|---------|
| `@moc-global/loft-base-tsconfig` | `loft-base-tsconfig/` | Shared TypeScript config (experimentalDecorators + emitDecoratorMetadata) |
| `@moc-global/loft-kysely-pg-migrator` | `loft-kysely-pg-migrator/` | Shared Kysely migration utility |
| `@moc-global/loft-middleware` | `loft-middleware/` | Guard middleware: PII redaction and prompt-injection detection (experimental) |
| `@moc-global/loft-pglite` | `loft-pglite/` | In-process PostgreSQL for tests |
| `@moc-global/loft-test-suite` | `loft-test-suite/` | Test utilities (mock/spy logger, scripted LLM, repository contract suites) |

---

## Directory-to-NPM Name Mismatches

| Directory | npm Package Name |
|-----------|-----------------|
| `loft-manifest-s3-strategy/` | `@moc-global/loft-aws-s3-repository` |
| `loft-manifest-gcp-storage-repository/` | `@moc-global/loft-gcp-storage-repository` |
| `loft-azure-blob-repository/` | `@moc-global/loft-azure-blob-storage-repository` |

---

## Package Dependency Graph

All published packages take `@moc-global/loft-definitions` as a peer dependency; none bundle it. `@moc-global/loft-agents` additionally peers on `@moc-global/loft`.

```
@moc-global/loft
  └── @moc-global/loft-definitions

@moc-global/loft-agents
  ├── @moc-global/loft
  └── @moc-global/loft-definitions

@moc-global/loft-{openai,anthropic,gemini}-strategy
  └── @moc-global/loft-definitions

@moc-global/loft-{session,chat-history}-pg-repository
  └── @moc-global/loft-definitions

@moc-global/loft-{aws-s3,gcp-storage,azure-blob-storage}-repository
  └── @moc-global/loft-definitions

@moc-global/loft-llm-call-manager
  └── @moc-global/loft-definitions

@moc-global/loft-queue-sqs-strategy
  └── @moc-global/loft-definitions
```
