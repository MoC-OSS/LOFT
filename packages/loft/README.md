# @moc-global/loft

The core of [LOFT](https://github.com/MoC-OSS/LOFT), a TypeScript framework for the LLM side of a chat backend. It wires the parts together with dependency injection and runs each chat turn: it loads the manifest and the session's history, runs your middleware, and calls the model through a provider strategy. `result.messages.save()` then stores the turn.

## Install

```bash
npm install @moc-global/loft @moc-global/loft-definitions reflect-metadata inversify@^6 zod@^3.25.67 @modelcontextprotocol/sdk
```

You also need a provider strategy, such as [`@moc-global/loft-openai-strategy`](https://www.npmjs.com/package/@moc-global/loft-openai-strategy), and storage for sessions and chat history, such as [`@moc-global/loft-session-pg-repository`](https://www.npmjs.com/package/@moc-global/loft-session-pg-repository) and [`@moc-global/loft-chat-history-pg-repository`](https://www.npmjs.com/package/@moc-global/loft-chat-history-pg-repository). For `LangfuseTracer`, also install `langfuse@^3`.

## Usage

`LoftConstructor` takes a manifest manager and a chat constructor. Register a provider strategy for each LLM name, then call `getInstance()`:

```typescript
import 'reflect-metadata';

import { ChatConstructor, FsRepositoryConstructor, LoftConstructor, ManifestManagerConstructor } from '@moc-global/loft';
import { Interface, Repository, Strategy, Type } from '@moc-global/loft-definitions';

export async function createLoft(
  sessionRepository: Interface.BaseComponentConstructor<Repository.Session>,
  chatHistoryRepository: Interface.BaseComponentConstructor<Repository.ChatHistory>,
  llmStrategy: Strategy.LLM.LoftLLM<unknown, unknown>
) {
  const loftConstructor = new LoftConstructor(
    { logLevel: Interface.LogLevel.INFO },
    // Reads manifest/manifest.json relative to the working directory and caches it for a minute
    new ManifestManagerConstructor(new FsRepositoryConstructor(), {
      manifestPath: 'manifest/manifest.json',
      errorPath: 'manifest/errors/error.json',
      cacheExpirationTime: 60_000
    }),
    new ChatConstructor(sessionRepository, chatHistoryRepository)
  );
  await loftConstructor.registerLlmStrategy('gpt-4o-mini', llmStrategy);
  return loftConstructor.getInstance();
}

export async function reply(loft: Awaited<ReturnType<typeof createLoft>>, text: string) {
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
        content: [{ type: 'text', text }],
        llmName: 'gpt-4o-mini',
        manifestName: 'assistant',
        ctx: {},
        llmIgnore: false
      }
    ]
  });
  return result.messages.llmResponse.topChoice.content;
}
```

Call `await loft.shutdown()` before the process exits: it waits for running requests and stops the rate-limiter timers.

The [quickstart](https://github.com/MoC-OSS/LOFT/blob/main/docs/getting-started/quickstart.md) builds the whole setup, with PostgreSQL storage and an OpenAI or Anthropic strategy.

## Main exports

| Export | What it is |
| --- | --- |
| `LoftConstructor` | Builds a `LOFT` instance; registers LLM strategies and prompt computers |
| `ChatConstructor` | Sets up chat: session and history repositories, middleware, MCP clients, tool interceptors |
| `ManifestManagerConstructor` | Loads and caches manifests from a storage repository |
| `FsRepositoryConstructor` | Reads manifests from the local file system |
| `LOFT` | The instance: `loft.chat` (sessions, `generate()`, `addMessages()`) and `shutdown()` |
| `LangfuseTracer`, `NoOpTracerStrategy` | Tracing to Langfuse, or none |
| `LlmContextWindowCropper` | Drops old messages to fit the model's context window |
| `FocusRegistry` and the Focus helpers | Structured data collection over several turns |

## Configuration

| Argument | Type | What it sets |
| --- | --- | --- |
| `LoftConstructor` 1st | `{ logLevel?: Interface.LogLevel }` | Log level; default `INFO` |
| `LoftConstructor` 4th, optional | `Strategy.Tracer.TracerFactory` | Tracer, for example a `LangfuseTracer` |
| `LoftConstructor` 5th, optional | `Interface.LoggerStrategy` | Where logs go; default Pino to stdout |
| `ManifestManagerConstructor` 2nd | `{ manifestPath, errorPath, cacheExpirationTime }` | Manifest file, file for validation errors, cache time in milliseconds |
| `ChatConstructor` 5th, optional | `{ mcp?: { toolCacheTtl?, maxCallsPerGenerate? } }` | MCP tool cache time in milliseconds (default 60000), and the most LLM calls one `generate()` makes while running tools (default 10) |

## Documentation

- [Core concepts](https://github.com/MoC-OSS/LOFT/blob/main/docs/getting-started/core-concepts.md) and [processing pipeline](https://github.com/MoC-OSS/LOFT/blob/main/docs/concepts/processing-pipeline.md)
- [Middleware](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/middleware.md), [manifests](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/manifests.md), [MCP](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/mcp-integration.md), [tracing](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/tracing.md), [error handling](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/error-handling.md)
- [Configuration reference](https://github.com/MoC-OSS/LOFT/blob/main/docs/reference/configuration.md)

## License

[MIT](./LICENSE)
