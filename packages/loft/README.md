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

## Streaming

Pass `onEvent` to `generate()` to receive the reply while the model writes it (experimental). The call reports `start`, the text as `text-delta` events, the tool calls, and ends with exactly one `finish`, `error` or `abort`; `generate()` still returns the same result. This server takes a POST with a JSON body (`{ "sessionId": "…", "message": "…" }`) and sends each event as a Server-Sent Events frame:

```typescript
import { createServer, type IncomingMessage } from 'node:http';

import { Chat, Type } from '@moc-global/loft-definitions';

async function readJson(req: IncomingMessage, maxBytes = 32_768): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new Error('The body is too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createChatServer(chat: Chat.ChatInterface) {
  return createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end();
      return;
    }
    let body: { sessionId?: unknown; message?: unknown };
    try {
      body = (await readJson(req)) as { sessionId?: unknown; message?: unknown };
    } catch {
      res.writeHead(400).end();
      return;
    }
    const { sessionId, message } = body;
    if (typeof sessionId !== 'string' || typeof message !== 'string' || !message.trim()) {
      res.writeHead(400).end();
      return;
    }
    // SECURITY: authenticate the caller and check that the session belongs to them

    // A client that goes away cancels the generation
    const controller = new AbortController();
    // A comment frame every 15 seconds keeps proxies from closing a quiet connection
    const heartbeat = setInterval(() => {
      if (res.headersSent) res.write(': ping\n\n');
    }, 15_000);
    res.on('close', () => {
      clearInterval(heartbeat);
      controller.abort();
    });

    try {
      const result = await chat.generate({
        sessionId,
        directMessages: [
          {
            sessionId,
            role: Type.LLM.UnifiedMessageRole.user,
            author: 'user',
            content: [{ type: 'text', text: message }],
            llmName: 'gpt-4o-mini',
            manifestName: 'assistant',
            ctx: {},
            llmIgnore: false
          }
        ],
        signal: controller.signal,
        onEvent: (event) => {
          // The headers go out with the first event, `start`; a failure before it sends no event
          if (!res.headersSent) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-store, no-transform',
              'X-Accel-Buffering': 'no'
            });
          }
          // Token usage stays on the server
          const frame: Record<string, unknown> = { ...event };
          delete frame.usage;
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(frame)}\n\n`);
        }
      });
      // `finish` does not save anything: store the turn, then end the stream
      await result.messages.save();
      res.end();
    } catch {
      // Before `start` the error can still get a status code; after it, the client got an `error` or `abort` event
      if (!res.headersSent) res.writeHead(500);
      res.end();
    } finally {
      clearInterval(heartbeat);
    }
  });
}
```

Show `finish.text`, the final reply after the middleware, in place of what the deltas built up, check `finish.reason` (`content-filter` means a filter stopped the reply), and ignore event types you do not know. When a middleware that may change the reply is registered, text is held back until it has run.

This server is a starting point, not production code. It does not limit how much it buffers for a slow client, does not allow only one generation per session at a time, and does not guard against a payload that cannot be serialised. The [express-streaming example](https://github.com/MoC-OSS/LOFT/tree/main/examples/express-streaming) does all of that, with tool progress events, a disconnect policy and a checklist for production. Also read the [streaming guide](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/streaming.md), which explains the events, the options and the providers, and how to size the call manager's `concurrency`: by default one model serves one call at a time per process.

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
| `ChatConstructor` 5th, optional | `{ shutdownTimeout?, historyLimit?, mcp?: { toolCacheTtl?, maxCallsPerGenerate? }, streaming?: Chat.StreamOptions }` | `shutdownTimeout`: how long `shutdown()` waits for requests in flight, in milliseconds (no limit when unset). `historyLimit`: the most stored messages a request loads, the latest ones (default all). MCP tool cache time in milliseconds (default 60000), and the most LLM calls one `generate()` makes while running tools (default 10). `streaming` (experimental): the defaults of every `generate()` call that passes `onEvent`, which a call's `streamOptions` override key by key |

## Documentation

- [Core concepts](https://github.com/MoC-OSS/LOFT/blob/main/docs/getting-started/core-concepts.md) and [processing pipeline](https://github.com/MoC-OSS/LOFT/blob/main/docs/concepts/processing-pipeline.md)
- [Middleware](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/middleware.md), [manifests](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/manifests.md), [MCP](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/mcp-integration.md), [tracing](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/tracing.md), [error handling](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/error-handling.md)
- [Configuration reference](https://github.com/MoC-OSS/LOFT/blob/main/docs/reference/configuration.md)

## License

[MIT](./LICENSE)
