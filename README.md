# LOFT

[![CI](https://github.com/MoC-OSS/LOFT/actions/workflows/ci.yml/badge.svg)](https://github.com/MoC-OSS/LOFT/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@moc-global/loft)](https://www.npmjs.com/package/@moc-global/loft)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/MoC-OSS/LOFT/badge)](https://scorecard.dev/viewer/?uri=github.com/MoC-OSS/LOFT)

LOFT (LLM-Orchestrator Framework for TypeScript) runs the LLM side of a chat backend. You call it from your own Express, NestJS or serverless code, and it handles everything between your API and the model: sessions, chat history, prompts, middleware, tool calls and rate limits.

## Why LOFT

- **One message format for every provider.** OpenAI, Azure OpenAI, Anthropic and Gemini share the same request and response types, and a session can switch models between turns.
- **Prompts live outside the code.** System prompts and model settings are JSON manifests on local disk, S3, Google Cloud Storage or Azure Blob Storage, cached and reloaded without a redeploy.
- **You own the HTTP layer.** LOFT is a library, not a server, so it fits the framework, auth and deployment you already have.
- **Typed from end to end.** Every package ships TypeScript types for both ES modules and CommonJS.

## Features

- **LLM providers:** OpenAI, Azure OpenAI (API key or Microsoft Entra ID), Anthropic, and Google Gemini through Vertex AI or Google AI Studio.
- **Sessions and chat history** in PostgreSQL, with migration CLIs, or in your own store through the repository interfaces.
- **Middleware** at three stages: on incoming messages, before the LLM call (it can change or stop the call) and after it.
- **MCP tools:** connect Model Context Protocol servers, and wrap any tool call in an interceptor to add context, check access or change the result.
- **AI tasks:** one-off LLM calls for classification, extraction or summaries, outside any chat.
- **Rate limits and retries** per model, with token counting.
- **Context window cropping** to keep long histories within the model's limit.
- **Tracing** with Langfuse or your own tracer.
- **Multi-agent workflows** (`@moc-global/loft-agents`): agent graphs, parallel fan-out, teams, and Focus for collecting structured data over several turns.
- **Graceful shutdown** that waits for running requests.

Not available yet: streaming and queued generation. Their types are exported and marked `@experimental`, but the public API has no way to run them. `HttpCallManagerStrategy` and the SQS queue strategy depend on them and are not usable on their own.

## Install

LOFT needs Node.js 22 or later. Install the core, a provider strategy, PostgreSQL storage and the call manager:

```bash
npm install @moc-global/loft @moc-global/loft-definitions @moc-global/loft-llm-call-manager \
  @moc-global/loft-openai-strategy \
  @moc-global/loft-session-pg-repository @moc-global/loft-chat-history-pg-repository \
  reflect-metadata inversify@^6 zod@^3.25.67 @modelcontextprotocol/sdk openai@^4 pg
```

inversify, reflect-metadata, zod, the MCP SDK and the provider SDK are peer dependencies, so your project and LOFT share one copy of each. LOFT needs inversify 6 and zod 3, not the latest majors. npm 7 or later and pnpm install missing peers; with Yarn, list them as above.

## Quickstart

This runs one chat turn against OpenAI and stores it in PostgreSQL. You need a PostgreSQL database and an OpenAI API key.

**1. Create the schemas and run the migrations.**

```bash
export DATABASE_URL=postgresql://user:password@localhost:5432/app
psql "$DATABASE_URL" -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE SCHEMA IF NOT EXISTS loft_session; CREATE SCHEMA IF NOT EXISTS loft_chat_history;'
DATABASE_SESSION_SCHEMA_NAME=loft_session npx loft-session-pg-migrate to-latest
DATABASE_CHAT_HISTORY_SCHEMA_NAME=loft_chat_history npx loft-chat-history-pg-migrate to-latest
```

**2. Write a manifest** at `manifest/manifest.json`. `assistant` is the manifest name, and `gpt-4o-mini` is the LLM name you register in code:

```json
{
  "llmManifests": {
    "assistant": {
      "gpt-4o-mini": {
        "systemMessage": "You are a helpful assistant.",
        "modelPreset": { "model": "gpt-4o-mini", "temperature": 0.7, "max_tokens": 500 }
      }
    }
  },
  "prompts": {},
  "aiTasks": {}
}
```

**3. Run the code** with `OPENAI_API_KEY` and `DATABASE_URL` set:

```typescript
import 'reflect-metadata';

import { ChatConstructor, FsRepositoryConstructor, LoftConstructor, ManifestManagerConstructor } from '@moc-global/loft';
import {
  ChatHistoryPostgresDialect,
  ChatHistoryRepositoryConstructor
} from '@moc-global/loft-chat-history-pg-repository';
import { Interface, NativeCallManagerStrategy, Type } from '@moc-global/loft-definitions';
import { GenerateCallManager, LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';
import {
  OpenAiCallStrategy,
  OpenAiLoftStrategy,
  OpenAiRequest,
  OpenAiResponse
} from '@moc-global/loft-openai-strategy';
import { SessionPostgresDialect, SessionRepositoryConstructor } from '@moc-global/loft-session-pg-repository';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const loftConstructor = new LoftConstructor(
    { logLevel: Interface.LogLevel.WARN },
    new ManifestManagerConstructor(new FsRepositoryConstructor(), {
      manifestPath: 'manifest/manifest.json',
      errorPath: 'manifest/errors/error.json',
      cacheExpirationTime: 60_000
    }),
    new ChatConstructor(
      new SessionRepositoryConstructor(new SessionPostgresDialect({ pool }), { schema: 'loft_session' }),
      new ChatHistoryRepositoryConstructor(new ChatHistoryPostgresDialect({ pool }), { schema: 'loft_chat_history' })
    )
  );

  // The call manager queues, rate-limits and retries the calls to one model
  const callManager = new GenerateCallManager<OpenAiRequest, OpenAiResponse>(
    'gpt-4o-mini',
    { highPriorityTasksLimit: 10, retryDelay: 1000, retryAttemptsLimit: 3 },
    new OpenAiCallStrategy(
      process.env.OPENAI_API_KEY!,
      new LlmTokenRateLimiter({
        newTokensPerSecond: 50_000,
        newRequestsPerSecond: 100,
        maxTokens: 2_000_000,
        maxRequests: 500,
        maxAwaitSeconds: 300
      }),
      new LlmTokenizer()
    )
  );
  await loftConstructor.registerLlmStrategy(
    'gpt-4o-mini',
    new OpenAiLoftStrategy({ llmName: 'gpt-4o-mini' }, new NativeCallManagerStrategy(callManager))
  );

  const loft = loftConstructor.getInstance();
  const session = await loft.chat.createSession({
    currentLlmName: 'gpt-4o-mini',
    currentManifestName: 'assistant',
    ctx: {}
  });
  const result = await loft.chat.generate({
    sessionId: session.id,
    directMessages: [
      {
        sessionId: session.id,
        role: Type.LLM.UnifiedMessageRole.user,
        author: 'user',
        content: [{ type: 'text', text: 'What can you help me with?' }],
        llmName: 'gpt-4o-mini',
        manifestName: 'assistant',
        ctx: {},
        llmIgnore: false
      }
    ]
  });

  for (const part of result.messages.llmResponse.topChoice.content) {
    if (part.type === 'text') console.log(part.text);
  }
  // Store the user message and the reply; generate() itself stores nothing
  await result.messages.save();

  await loft.shutdown();
  await pool.end();
}

main();
```

The next `generate()` on the same session loads the saved messages and sends them with the new one. The [full quickstart](./docs/getting-started/quickstart.md) explains each step and shows the Anthropic variant.

## Examples

Each example is a small application in [`examples/`](./examples/) that you can run from this repository. They are for learning, not for production: none has authentication.

| Example | What it shows | Provider | Database |
| --- | --- | --- | --- |
| [express-basic](./examples/express-basic/) | One request, one response | OpenAI | PGlite, in process |
| [express-history](./examples/express-history/) | Multi-turn chat with stored history | OpenAI | PGlite |
| [nestjs](./examples/nestjs/) | LOFT as a NestJS module | OpenAI | PGlite |
| [serverless](./examples/serverless/) | An AWS Lambda handler | OpenAI | PGlite |
| [express-full](./examples/express-full/) | Middleware, dynamic prompts, session CRUD | Anthropic | PostgreSQL in Docker |
| [express-focus-basic](./examples/express-focus-basic/) | Focus: collect an order over several turns | Anthropic | PostgreSQL in Docker |
| [express-agents](./examples/express-agents/) | Agent graphs, fan-out and teams | Anthropic | PostgreSQL in Docker |

The [examples guide](./examples/README.md) has the setup steps.

## Packages

| Package | What it does |
| --- | --- |
| [`@moc-global/loft`](./packages/loft/) | The core: constructors, chat workflow, middleware, manifests, MCP, tracing |
| [`@moc-global/loft-definitions`](./packages/loft-definitions/) | Shared types, interfaces, schemas, DI symbols and the logger |
| [`@moc-global/loft-openai-strategy`](./packages/loft-openai-strategy/) | OpenAI and Azure OpenAI |
| [`@moc-global/loft-anthropic-strategy`](./packages/loft-anthropic-strategy/) | Anthropic Claude |
| [`@moc-global/loft-gemini-strategy`](./packages/loft-gemini-strategy/) | Google Gemini, through Vertex AI or Google AI Studio |
| [`@moc-global/loft-llm-call-manager`](./packages/loft-llm-call-manager/) | Rate limits, retries and token counting for LLM calls |
| [`@moc-global/loft-session-pg-repository`](./packages/loft-session-pg-repository/) | Sessions in PostgreSQL, with a migration CLI |
| [`@moc-global/loft-chat-history-pg-repository`](./packages/loft-chat-history-pg-repository/) | Chat history in PostgreSQL, with a migration CLI |
| [`@moc-global/loft-aws-s3-repository`](./packages/loft-manifest-s3-strategy/) | Manifests in AWS S3 |
| [`@moc-global/loft-gcp-storage-repository`](./packages/loft-manifest-gcp-storage-repository/) | Manifests in Google Cloud Storage |
| [`@moc-global/loft-azure-blob-storage-repository`](./packages/loft-azure-blob-repository/) | Manifests in Azure Blob Storage |
| [`@moc-global/loft-agents`](./packages/loft-agents/) | Multi-agent orchestration |
| [`@moc-global/loft-queue-sqs-strategy`](./packages/loft-queue-sqs-strategy/) | AWS SQS queue for queued generation (experimental) |

The [packages reference](./docs/reference/packages.md) lists the key exports and supported SDK versions of each.

## Documentation

- [Introduction](./docs/getting-started/introduction.md) and [core concepts](./docs/getting-started/core-concepts.md)
- [Architecture](./docs/concepts/architecture.md) and the [processing pipeline](./docs/concepts/processing-pipeline.md)
- Guides: [LLM strategies](./docs/guides/llm-strategies.md), [middleware](./docs/guides/middleware.md), [manifests](./docs/guides/manifests.md), [chat persistence](./docs/guides/chat-persistence.md), [MCP](./docs/guides/mcp-integration.md), [agents](./docs/guides/agents.md), [tracing](./docs/guides/tracing.md), [error handling](./docs/guides/error-handling.md)
- Reference: [configuration](./docs/reference/configuration.md), [environment variables](./docs/reference/environment-variables.md), [DI symbols](./docs/reference/di-symbols.md)

The [documentation index](./docs/README.md) lists every page.

## Compatibility

| | Supported |
| --- | --- |
| Node.js | 22 or later; CI tests 22, 24 and 26 |
| Module formats | ES modules and CommonJS, each with its own types |
| TypeScript | 5.x |
| inversify, zod | 6, 3 |
| Provider SDKs | `openai` 4, `@anthropic-ai/sdk` 0.39, `@google/genai` 1 ([details](./docs/reference/packages.md#supported-provider-sdk-versions)) |

## Contributing

Bug reports and pull requests are welcome. [CONTRIBUTING.md](./CONTRIBUTING.md) shows how to build and test the monorepo, add a changeset and open a pull request. Sign off each commit (`git commit -s`) to certify the [Developer Certificate of Origin](https://developercertificate.org/). Everyone taking part follows the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Support

Ask questions in [GitHub Discussions](https://github.com/MoC-OSS/LOFT/discussions) and report bugs in [GitHub Issues](https://github.com/MoC-OSS/LOFT/issues). [SUPPORT.md](./SUPPORT.md) has the details.

## Security

Do not report security problems in public issues. Use [private vulnerability reporting](https://github.com/MoC-OSS/LOFT/security/advisories/new) instead; [SECURITY.md](./SECURITY.md) describes the process and the response times.

## License

[MIT](./LICENSE) © 2026 Master of Code Global
