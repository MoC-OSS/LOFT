# How to Handle Errors

LOFT defines a hierarchy of error classes for different failure scenarios. This guide covers the error types, how they propagate, and how to handle them in your application.

## Error Hierarchy

All LOFT errors extend `ChatError`, which extends the native `Error`:

```
Error
  └── ChatError
        ├── GenerateError                — LLM generation failures
        ├── ShutdownError                — Operation rejected during shutdown
        ├── SessionNotFoundError         — The session does not exist
        ├── AppendMessageError           — @experimental, queued mode only
        ├── GetPendingMessagesError       — @experimental, queued mode only
        └── ProcessSessionActionsError   — @experimental, queued mode only
```

All error classes are exported from `@moc-global/loft-definitions`. With `LoftConstructor`, `generate()` throws `GenerateError`, `addMessages()` rethrows the original error, both throw `ShutdownError` during shutdown, and every method that loads a session throws `SessionNotFoundError` when it does not exist. The three experimental classes belong to execution modes that are not available yet.

Every `ChatError` has `sessionId`, `correlatorIds`, `messageIds`, `status` (a `Chat.Status`), `cause` (the original error, whose stack is appended to the error's stack after `Caused by:`) and an optional `details` object. `shouldRetry()` returns `false` for the errors LOFT throws today, so decide on retries yourself (see [Retry with backoff](#retry-with-backoff)).

## GenerateError

The most common error — thrown when `generate()` fails.

```typescript
import { GenerateError, Chat } from '@moc-global/loft-definitions';

try {
  const result = await loft.chat.generate({ sessionId, directMessages });
} catch (error) {
  if (error instanceof GenerateError) {
    console.error('Generation failed:', {
      sessionId: error.sessionId,
      correlatorIds: error.correlatorIds,
      messageIds: error.messageIds,
      status: error.status,        // Chat.Status enum
      message: error.message,
      cause: error.cause           // Original error (if wrapped)
    });
  }
}
```

### GenerateError Status Codes

| Status | Meaning |
|--------|---------|
| `Chat.Status.ERROR` | General generation failure (LLM API error, middleware error, etc.) |
| `Chat.Status.ALREADY_GENERATED` | No pending messages — response already generated for this session state |

### Common Causes

- **Invalid messages:** `directMessages` content doesn't match the `CreateMessage` Zod schema (e.g., `content` is a string instead of an array of content parts)
- **LLM API error:** Provider returned an error (rate limit, invalid request, server error)
- **Missing strategy:** No LLM strategy registered for the requested `llmName`
- **Manifest not found:** No manifest entry for the `manifestName` + `llmName` combination
- **Context error:** Failed to load session or chat history
- **Stream timeout:** a call streamed with `onEvent` stayed silent longer than the call manager's `streamIdleTimeoutMs` (or waited longer than `streamFirstEventTimeoutMs` for its first output: text, reasoning or activity). The cause chain holds a `StreamIdleTimeoutError` (experimental, not a `ChatError`), which the call manager retries while nothing reached the caller.
- **Middleware error:** A middleware threw. The chain throws `Error('Forced failure in middleware: <name>, ...')` with your error as its `cause`, and `generate()` wraps that error in a `GenerateError` as its `cause`. `addMessages()` runs only Input middleware and throws the chain's error as is, without a `GenerateError`.

## ShutdownError

Thrown when an operation is attempted after `shutdown()` has been called:

```typescript
import { ShutdownError } from '@moc-global/loft-definitions';

try {
  const result = await loft.chat.generate({ sessionId, directMessages });
} catch (error) {
  if (error instanceof ShutdownError) {
    // LOFT is shutting down — reject the request at your API layer.
    // error.status is Chat.Status.SHUTDOWN
    console.log('Service shutting down, operation rejected:', error.operationId);
  }
}
```

## Graceful Shutdown

LOFT supports graceful shutdown — active operations complete before the service stops:

```typescript
// In your application shutdown handler
const shutdown = async () => {
  // 1. Stop accepting new requests at your HTTP layer

  // 2. Shut LOFT down — waits for active generate() calls, stops the LLM rate-limiter timers and shuts the tracer down
  await loft.shutdown();

  // 3. Close what your application opened: database connections, MCP clients
  await pool.end();

  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

Call `loft.shutdown()`, not only `loft.chat.shutdown()`. Both wait for active operations, but only `loft.shutdown()` then stops the rate-limiter and queue timers of every registered LLM strategy, which can otherwise keep the process running, and shuts the tracer down so it sends what it still holds. `loftConstructor.gracefulShutdown()`, which used to do the last step, is deprecated. LOFT does not close the database pools or the MCP clients: your application creates them, so it closes them.

After `shutdown()` is called:
- Active operations continue to completion, including the steps they start after `shutdown()` was called
- New operations throw `ShutdownError`
- The `shutdown()` promise resolves when all active operations finish, or after `ChatConfig.shutdownTimeout` milliseconds with a warning in the log; without the setting it waits as long as they run
- After the timeout, `loft.shutdown()` stops the LLM strategies and the tracer although operations still run: a call waiting in a rate-limiter queue may never finish, and the spans those operations end later are lost. Pick a timeout longer than your slowest request
- LOFT logs each step at INFO level

## Missing Sessions

`generate()`, `addMessages()`, `getSessionById()`, `getSessionByExternalKey()`, `updateSessionSettings()` and `deleteSession()` reject with a `SessionNotFoundError` when the session does not exist. `generate()` throws it as it is, not wrapped in a `GenerateError`. The error has the `sessionId` (or the `externalKey` it was looked up by), and its message is `Session with id <id> not found`. An id that is not a UUID fails in the database instead. `getChatHistory()` does not check the session: it returns an empty list for an unknown id, and the kept messages of a deleted one.

Handle it at your API boundary: validate the id's format, and turn the error into the response your API defines, for example 404:

```typescript
import { SessionNotFoundError } from '@moc-global/loft-definitions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.get('/api/sessions/:id', async (req, res) => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: 'Invalid session id' });
    return;
  }
  try {
    res.json(await loft.chat.getSessionById(req.params.id));
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

A custom `Repository.Session` should throw `SessionNotFoundError` from `getById()`, `getByExternalKey()`, `updateById()` and `deleteById()` as well, so this works with any storage.

## Error Handling Patterns

### Catch at the API boundary

```typescript
app.post('/api/chat', async (req, res) => {
  try {
    const result = await loft.chat.generate({
      sessionId: req.body.sessionId,
      directMessages: req.body.messages
    });
    res.json({ success: true, messages: result.messages });
  } catch (error) {
    if (error instanceof GenerateError) {
      if (error.status === Chat.Status.ALREADY_GENERATED) {
        res.status(409).json({ error: 'Response already generated for this session state' });
      } else {
        res.status(500).json({ error: 'Generation failed', message: error.message });
      }
    } else if (error instanceof ShutdownError) {
      res.status(503).json({ error: 'Service shutting down' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});
```

### Errors in a streamed call

A `generate()` call with `onEvent` rejects with the same errors. A failure before the `start` event sends no event, so a handler can still answer it with a status code. After `start`, the caller first gets an `error` event with a fixed message per code (`provider_error`, `rate_limited`, `timeout`, `internal`), never the provider's text, or an `abort` event with `reason: 'timeout'` (the signal came from a timeout) or `'cancelled'` when the call was cancelled; a `rate_limited` error event carries `retryAfterMs` when the provider sent a `Retry-After` header; then `generate()` rejects with the full error, for your logs. A streamed call is not retried once text or reasoning reached the caller. See [Streaming](./streaming.md#errors).

### Retry with backoff

LOFT's `GenerateCallManager` retries an LLM API call that failed with 408, 429, a 5xx, a network error or a provider error of type `overloaded_error`, `api_error` or `server_error` that arrives without a status (as one does inside a stream), with exponential backoff (configurable via `retryDelay` and `retryAttemptsLimit`, see [Call manager](./llm-strategies.md)). Other errors, such as a 400 or 401, are thrown at once. For application-level retries:

```typescript
async function generateWithRetry(options: Chat.GenerateOptions, maxRetries = 3): Promise<Chat.GenerateResult> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await loft.chat.generate(options);
    } catch (error) {
      if (error instanceof GenerateError && attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt - 1); // exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Unreachable');
}
```

### Health checks

Use the built-in health check to verify all components are reachable:

```typescript
app.get('/health', async (req, res) => {
  try {
    const healthy = await loft.chat.checkHealth();
    res.status(healthy ? 200 : 503).json({ healthy });
  } catch (error) {
    res.status(503).json({ healthy: false, error: String(error) });
  }
});
```

`checkHealth()` verifies, stopping at the first failure:
- The session repository works: the PostgreSQL repository checks that its schema exists
- The chat history repository works, the same way
- Each registered LLM strategy's call manager reports healthy. `NativeCallManagerStrategy` always does, so the provider's API is not called; send a real request if you need to know the provider is reachable

Manifest storage is not checked.
