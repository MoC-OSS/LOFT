# How to Set Up Tracing

LOFT has built-in observability via a pluggable tracer strategy. The default is `NoOpTracerStrategy` (no tracing). For production, use the `LangfuseTracer` or implement a custom tracer.

## Langfuse Integration

[Langfuse](https://langfuse.com/) is an open-source LLM observability platform. LOFT includes a built-in integration.

### Setup

`langfuse` is an optional peer dependency of `@moc-global/loft`. Install it to use the tracer; without it, creating a `LangfuseTracer` throws an error that says so.

```bash
npm install langfuse@^3
```

```typescript
import { LoftConstructor, LangfuseTracer } from '@moc-global/loft';

const tracer = new LangfuseTracer({
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  baseUrl: process.env.LANGFUSE_HOST          // Optional. Default: https://cloud.langfuse.com
});

const loftConstructor = new LoftConstructor(
  { logLevel: Interface.LogLevel.INFO },
  manifestManagerConstructor,
  chatConstructor,
  tracer                                       // 4th parameter
);
```

`LangfuseTracer` loads `langfuse` itself when it is created, in a way bundlers such as esbuild and webpack cannot see. If you bundle your application (for example for AWS Lambda), import the `Langfuse` class yourself and pass it, so the bundler includes it:

```typescript
import { Langfuse } from 'langfuse';

const tracer = new LangfuseTracer({ secretKey, publicKey }, { Langfuse });
```

### LangfuseTracerConfig

```typescript
interface LangfuseTracerConfig {
  secretKey: string;          // Required: Langfuse secret key
  publicKey: string;          // Required: Langfuse public key
  baseUrl?: string;           // Optional: API endpoint (default: https://cloud.langfuse.com)
  enabled?: boolean;          // Optional: disable tracing (default: true)
  release?: string;           // Optional: release/version identifier
  requestTimeout?: number;    // Optional: API request timeout in ms
  environment?: string;       // Optional: environment name (e.g., 'production')
}
```

### What Gets Traced

LOFT automatically creates traces at multiple levels:

| Trace Level | Name Pattern | Contains |
|------------|-------------|----------|
| **Trace** | `loft-generate-{sessionId}` | One per `generate()` or `addMessages()` call, with the session ID |
| **Span** | `chat/generate` | The full generate lifecycle |
| **Span** | `chat/addMessages` | Storing messages through `addMessages()` |
| **Span** | `middleware/{type}/{name}` | Each middleware execution, with the payload it received |
| **Span** | `llm-operation/{manifest}/{llm}` | LLM operation including tool loops |
| **Span** | `computer/{type}/{name}` | Each prompt computer run |
| **Generation** | `{manifest}/{llm}:{model}#{iteration}` | Each LLM API call with model, usage, cost |
| **Span** | `mcp-tool-{toolName}` | Each MCP tool execution |
| **Span** | `additional-tool-{toolName}` | Each call of a tool passed to `generate()` as an additional tool |

Traces record message content as it arrived, before any middleware ran, so redacting personal data in middleware does not keep it out of Langfuse.

Generations include:
- Model name and parameters
- Input/output messages
- Token usage (prompt, completion, total)
- Cost tracking
- Finish reason
- Latency (via `completionStartTime`)

### Flushing

`generate()` flushes the tracer before it returns, and waits for the flush, so with Langfuse each request includes the time to send its trace. If `generate()` fails, LOFT also flushes, and a failed flush there is only logged. A flush that throws after a successful generation fails the request, so a custom tracer's `flushAsync()` must not throw.

### Graceful Shutdown

Flush the rest of the buffered data on shutdown:

```typescript
process.on('SIGTERM', async () => {
  await loft.shutdown();                      // Wait for active operations, stop the LLM rate-limiter timers
  await loftConstructor.gracefulShutdown();   // Flush tracer data
  process.exit(0);
});
```

## Custom Tracer

Implement `Strategy.Tracer.TracerFactory` to use your own tracing backend. A tracer creates spans, generations and events, records scores, and gives LOFT a copy scoped to a parent span (`withParent`); spans can have child spans:

```typescript
import { randomUUID } from 'node:crypto';

import { Strategy } from '@moc-global/loft-definitions';

function createSpan(name: string): Strategy.Tracer.Span {
  // Start a span called `name` in your backend here
  return {
    id: randomUUID(),
    end: () => { /* close the span */ },
    span: (params) => createSpan(params.name),
    generation: () => ({ id: randomUUID(), end: () => { /* close with usage data */ } }),
    event: () => { /* record a point-in-time event */ }
  };
}

function createTracer(traceId: string): Strategy.Tracer.Tracer {
  return {
    span: (params) => createSpan(params.name),
    generation: () => ({ id: randomUUID(), end: () => { /* close with usage data */ } }),
    event: () => { /* record an event */ },
    score: () => { /* record a score on the trace */ },
    update: () => { /* update trace input, output, metadata or tags */ },
    flushAsync: async () => { /* send buffered data; must not throw */ },
    withParent: () => createTracer(traceId) // a real tracer attaches what it creates to the given parent ID
  };
}

class MyTracerFactory implements Strategy.Tracer.TracerFactory {
  createTracer(params: Parameters<Strategy.Tracer.TracerFactory['createTracer']>[0]): Strategy.Tracer.Tracer {
    // params: traceId, name, and optional userId, sessionId, metadata, tags
    return createTracer(params.traceId);
  }

  async shutdownAsync(): Promise<void> {
    // Flush and close connections
  }
}
```

## Using Traces in Middleware

Inside any middleware, you have access to the tracer via context:

```typescript
chatConstructor.registerBeforeGenerateMiddleware('my-traced-step', async (context, payload, chain) => {
  // LOFT automatically creates a span for this middleware.
  // Create additional nested spans for sub-operations:
  const span = context.tracer.span({
    name: 'external-api-call',
    input: { query: '...' },
    metadata: { service: 'my-api' }
  });

  try {
    const result = await callExternalApi();
    span.end({ output: result, level: 'DEFAULT' });
  } catch (error) {
    span.end({ level: 'ERROR', statusMessage: String(error) });
    throw error;
  }

  chain.next();
  return payload;
});
```

Spans can have children: `span.span({...})`, `span.generation({...})` and `span.event({...})`. Levels are `DEBUG`, `DEFAULT`, `WARNING` and `ERROR`. End every span, also when your code throws, or it stays open in the trace.

Events and scores need no `end()`:

```typescript
chatConstructor.registerAfterGenerateMiddleware('rate-answer', async (context, payload, chain) => {
  // A point-in-time event, for example a cache hit or a decision your code made
  context.tracer.event({ name: 'answer-ready', output: { parts: payload.llmResponse.topChoice.content.length } });

  // A score on the trace, for example from your own quality check or user feedback
  context.tracer.score({ name: 'answer-length-ok', value: 1, dataType: 'BOOLEAN', comment: 'Within limits' });

  chain.next();
  return payload;
});
```

`dataType` is `NUMERIC`, `CATEGORICAL` or `BOOLEAN`.

## Disabling Tracing

By default (no tracer passed to `LoftConstructor`), LOFT uses `NoOpTracerStrategy` which does nothing — zero overhead. To explicitly disable:

```typescript
import { NoOpTracerStrategy } from '@moc-global/loft';

const loftConstructor = new LoftConstructor(
  config,
  manifestManagerConstructor,
  chatConstructor,
  new NoOpTracerStrategy()   // Explicitly no-op
);
```

## Troubleshooting: Jest and Langfuse

Under Jest, creating a `LangfuseTracer` can fail with `A dynamic import callback was invoked without --experimental-vm-modules`, because the Langfuse SDK loads part of itself with `import()`. LOFT loads Langfuse only when a `LangfuseTracer` is created, so the simplest fix is to leave the tracer out in tests (LOFT then uses `NoOpTracerStrategy`). Otherwise, mock the `langfuse` module, run Jest with `NODE_OPTIONS=--experimental-vm-modules`, or use Vitest.
