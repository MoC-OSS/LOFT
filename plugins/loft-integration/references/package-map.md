# LOFT Package Map

## Contents

- Package Selection Guide
- Minimum Viable Install
- Full Package Catalog
- Directory-to-NPM Name Mismatches
- Package Dependency Graph

All packages in the `@moc-global/loft` monorepo, verified against loft 2.7.3 (`@moc-global/loft` version below). If the installed version differs, check `node_modules/@moc-global/loft/package.json` and confirm via source.

> **Package manager:** Commands below use `npm`. Substitute `yarn add` or `pnpm add` if that's what your project uses.

---

## Package Selection Guide

### Always Required

```bash
npm install @moc-global/loft @moc-global/loft-definitions reflect-metadata inversify
```

### Pick One LLM Provider

| Package | Models | API Key Format |
|---------|--------|---------------|
| `@moc-global/loft-openai-strategy` | GPT-4o, GPT-3.5; Azure OpenAI | Plain string (`OpenAiCallStrategy(apiKey, ...)`) |
| `@moc-global/loft-anthropic-strategy` | Claude 3.x / 3.5 / 4 | Object (`AnthropicCallStrategy({ apiKey }, ...)`) |
| `@moc-global/loft-gemini-strategy` | Gemini 1.5/2.0 | Config object (`GeminiCallStrategy({ mode, apiKey/project }, ...)`) |

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

Every LLM strategy setup pattern requires `GenerateCallManager`, `LlmTokenRateLimiter`, and `LlmTokenizer` from this package. While technically you could implement your own `CallManager` strategy, no alternative is provided out of the box.

```bash
npm install @moc-global/loft-llm-call-manager
```

---

## Minimum Viable Install

```bash
npm install @moc-global/loft @moc-global/loft-definitions reflect-metadata inversify
npm install @moc-global/loft-openai-strategy                # or anthropic/gemini
npm install @moc-global/loft-llm-call-manager               # rate limiting + retry
npm install @moc-global/loft-session-pg-repository @moc-global/loft-chat-history-pg-repository pg
```

---

## Full Package Catalog

### Core

| npm Name | Directory | Version | Purpose | Key Exports |
|----------|-----------|---------|---------|-------------|
| `@moc-global/loft` | `loft/` | 2.7.3 | Core framework: DI bootstrap, chat workflow, middleware pipeline | `LoftConstructor`, `ChatConstructor`, `ManifestManagerConstructor`, `FsRepositoryConstructor`, `LOFT`, `BaseLoftChat`, `LlmManager`, `ManifestManager`, `LangfuseTracer`, `NoOpTracerStrategy`, `LlmContextWindowCropper` |
| `@moc-global/loft-definitions` | `loft-definitions/` | 1.6.3 | All types, interfaces, DI symbols, Logger, Zod schemas | `DI_TYPES`, `Interface.*`, `Strategy.*`, `Type.*`, `Repository.*`, `Schema.*`, `Chat.*`, `Logger`, `PinoLoggerStrategy`, `NativeCallManagerStrategy`, `LogLevel` |

### LLM Strategies

| npm Name | Directory | Version | Key Exports |
|----------|-----------|---------|-------------|
| `@moc-global/loft-openai-strategy` | `loft-openai-strategy/` | 1.2.12 | `OpenAiLoftStrategy`, `OpenAiCallStrategy`, `AzureOpenAiLoftStrategy`, `AzureOpenAiCallStrategy`, `OpenAiRequest`, `OpenAiResponse` |
| `@moc-global/loft-anthropic-strategy` | `loft-anthropic-strategy/` | 1.0.16 | `AnthropicLoftStrategy`, `AnthropicCallStrategy`, `AnthropicRequest`, `AnthropicResponse` |
| `@moc-global/loft-gemini-strategy` | `loft-gemini-strategy/` | 1.0.4 | `GeminiLoftStrategy`, `GeminiCallStrategy`, `GeminiStrategyConfig`, `GeminiStream` |

### Call Management

| npm Name | Directory | Version | Key Exports |
|----------|-----------|---------|-------------|
| `@moc-global/loft-llm-call-manager` | `loft-llm-call-manager/` | 1.0.20 | `GenerateCallManager`, `GenerateWithStreamManager`, `GenerateWithQueueManager`, `LlmTokenizer`, `LlmTokenRateLimiter` |

### Database Repositories

| npm Name | Directory | Version | Key Exports | CLI |
|----------|-----------|---------|-------------|-----|
| `@moc-global/loft-session-pg-repository` | `loft-session-pg-repository/` | 1.2.4 | `SessionRepositoryConstructor`, `SessionPostgresDialect`, `runSessionPgMigrations` | `loft-session-pg-migrate` |
| `@moc-global/loft-chat-history-pg-repository` | `loft-chat-history-pg-repository/` | 1.3.4 | `ChatHistoryRepositoryConstructor`, `ChatHistoryPostgresDialect`, `runChatHistoryPgMigrations` | `loft-chat-history-pg-migrate` |

### Object Storage (Manifest)

| npm Name | Directory | Version | Key Exports |
|----------|-----------|---------|-------------|
| `@moc-global/loft-aws-s3-repository` | `loft-manifest-s3-strategy/` | 1.0.22 | `AwsS3RepositoryConstructor` |
| `@moc-global/loft-gcp-storage-repository` | `loft-manifest-gcp-storage-repository/` | 1.0.20 | `GcpStorageRepositoryConstructor` |
| `@moc-global/loft-azure-blob-storage-repository` | `loft-azure-blob-repository/` | 1.0.17 | `AzureBlobStorageRepositoryConstructor` |

### Queue

| npm Name | Directory | Version | Key Exports | Status |
|----------|-----------|---------|-------------|--------|
| `@moc-global/loft-queue-sqs-strategy` | `loft-queue-sqs-strategy/` | 1.0.17 | `SQSStrategy` | Infrastructure works; consumer-facing path (`QueuedLoftConstructor`) is commented out |

### Private Packages (not published)

| npm Name | Directory | Purpose |
|----------|-----------|---------|
| `@moc-global/loft-base-tsconfig` | `loft-base-tsconfig/` | Shared TypeScript config (experimentalDecorators + emitDecoratorMetadata) |
| `@moc-global/loft-kysely-pg-migrator` | `loft-kysely-pg-migrator/` | Shared Kysely migration utility |
| `@moc-global/loft-pglite` | `loft-pglite/` | In-process PostgreSQL for tests |
| `@moc-global/loft-test-suite` | `loft-test-suite/` | Test utilities (spy/mock logger) |

Note: `@moc-global/loft-base-package` (v1.0.6) is published but contains only a placeholder `console.log` — no functional exports.

---

## Directory-to-NPM Name Mismatches

| Directory | npm Package Name |
|-----------|-----------------|
| `loft-manifest-s3-strategy/` | `@moc-global/loft-aws-s3-repository` |
| `loft-manifest-gcp-storage-repository/` | `@moc-global/loft-gcp-storage-repository` |
| `loft-azure-blob-repository/` | `@moc-global/loft-azure-blob-storage-repository` |

---

## Package Dependency Graph

All published packages depend on `@moc-global/loft-definitions`. Only `@moc-global/loft` depends on `loft-definitions` as a runtime dependency. Strategy and repository packages are peers.

```
@moc-global/loft
  └── @moc-global/loft-definitions

@moc-global/loft-{openai,anthropic,gemini}-strategy
  └── @moc-global/loft-definitions

@moc-global/loft-{session,chat-history}-pg-repository
  └── @moc-global/loft-definitions

@moc-global/loft-{aws-s3,gcp-storage,azure-blob-storage}-repository
  └── @moc-global/loft-definitions

@moc-global/loft-llm-call-manager
  └── @moc-global/loft-definitions
```
