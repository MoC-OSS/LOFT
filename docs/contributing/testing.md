# Testing

LOFT has two test tiers: unit tests (no Docker) and integration tests. This guide covers both.

## Unit Tests

Unit tests run in-process using **PGLite** (an in-process PostgreSQL) — no Docker or external database needed.

### Running

```bash
# All unit tests
pnpm test:unit

# Specific package
pnpm run --filter=@moc-global/loft-definitions test

# Watch mode (during development)
npx vitest --watch packages
```

### Configuration

Root `vitest.config.mts`:
- **Includes:** `packages/**/src/**/*.test.ts`
- **Excludes:** `**/lib/**`, `**/node_modules/**`, `**/integration/**`, `**/*integration.test.ts`
- **Environment:** Node.js

### PGLite — In-Process PostgreSQL

The `@moc-global/loft-pglite` package provides `PGLiteInstanceFactory` for creating in-memory PostgreSQL instances per test:

```typescript
import { PGLiteInstanceFactory, PGLiteUtils } from '@moc-global/loft-pglite';

// Create instance
const instance = await PGLiteInstanceFactory.create();
const pool = PGLiteUtils.createPool(instance);  // max: 1 connection

// Create schemas
await PGLiteUtils.createSchemas(pool, ['loft_session', 'loft_chat_history']);

// Run migrations
await runSessionPgMigrations({ /* ... */ }, pool);

// Use in tests...

// Cleanup
await instance.close();
```

> **Key limitation:** PGLite supports only **1 concurrent connection**. All pools must use `max: 1`.

### Test Utilities

The `@moc-global/loft-test-suite` package provides logger mocks, tool-call fixtures and `ScriptedLLMStrategy`, a scripted LLM for offline tests (see [Writing an offline test](#writing-an-offline-test)). The logger mocks:

```typescript
import { configureMockLoggerStrategy, configureSpyLoggerStrategy } from '@moc-global/loft-test-suite';
import { beforeEach, vi } from 'vitest';

// Pure mock (no console output)
const mockLogger = configureMockLoggerStrategy();

// Spy (real console output + assertions)
const spyLogger = configureSpyLoggerStrategy();

beforeEach(() => vi.clearAllMocks());
```

### Test File Location

Place tests next to the source they test:
```
packages/loft/src/
  managers/
    LlmManager.ts
  __tests__/
    unit/
      managers/
        LlmManager.test.ts
```

## Integration Tests

The integration suite in `integration/` runs LOFT end to end: real constructors and middleware, PostgreSQL storage and in-memory MCP servers. It needs no keys and no Docker:

- **Database:** each test file starts its own in-process [PGlite](https://pglite.dev) and runs the migrations.
- **Model:** a scripted LLM, `ScriptedLLMStrategy` from `@moc-global/loft-test-suite`, answers from a list of replies (text, tool calls, an error, or a wait for cancellation) and records every request, so tests assert the exact tool calls, context windows and saved history.

### Running

```bash
pnpm build-packages              # the esm and cjs runs test the built packages
pnpm test:integration            # against the TypeScript sources
pnpm test:integration:esm        # against lib/index.mjs, as import loads it
pnpm test:integration:cjs        # against lib/index.js, as require loads it
```

CI runs the `esm` and `cjs` modes on every pull request. A test, `module-format.test.ts`, fails if a run loads a different build than its name says.

### Optional settings

Copy `integration/.env.test.example` to `integration/.env.test` to change them:

| Setting | Effect |
| --- | --- |
| `LOFT_TEST_DATABASE_URL` | Runs against that PostgreSQL server instead of PGlite. Each test file creates and drops a database of its own, so the user needs the CREATEDB privilege. `docker compose -f integration/docker-compose.dev.yml up -d` starts a matching server. |
| `LOFT_LOG_LEVEL` | LOFT's log level during the tests; default `FATAL`, because several tests provoke errors |
| Provider and Langfuse keys | Turn on the live tests |

### Live tests

Files named `*.live.test.ts` call real services and skip themselves when their keys are missing:

| File | Needs |
| --- | --- |
| `loft.tool-calls.live.test.ts` | `LOFT_OPENAI_API_KEY` and/or `LOFT_ANTHROPIC_API_KEY`; each provider runs when its key is set |
| `loft.gemini.live.test.ts` | `LOFT_GEMINI_VERTEX_PROJECT` and Application Default Credentials for it |
| `loft.langfuse.live.test.ts` | `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_HOST` |

### Writing an offline test

```typescript
import { initDB } from './initDB';
import { InitClientServer } from './mcpClientServerInMemory';
import { startScriptedChat, userMessage } from './scriptedChat';

const testDb = await initDB();
const { loft, llm, session } = await startScriptedChat(testDb, [
  { toolCalls: [{ name: 'add', arguments: { a: 2, b: 2 } }] },
  { text: 'It is 4.' }
], { mcpClients: { calculator: await InitClientServer() } });

const result = await loft.chat.generate({ sessionId: session.id, directMessages: [userMessage('2 + 2?', session.id)] });

expect(llm.calls[1].messages.at(-1)?.toolResults[0].text).toBe('4'); // what the model was sent
```

A call after the last scripted reply fails the test, so an unexpected extra model call does not go unnoticed.

### Scripting a streamed reply

A `text` or `toolCalls` reply can also describe how it streams. These fields (experimental) only take effect when the call has an `onEvent` sink and the reply has `chunks`. Without a sink the reply is answered with its `text` at once, as before.

| Field | Effect |
| --- | --- |
| `chunks` | The text in pieces, sent in order as `text-delta` events. The pieces must join to `text`, otherwise creating the strategy (or producing the reply, for a reply function) throws. Text beside tool calls streams the same way. |
| `activityChunks` | Number of `activity` events sent before the first chunk |
| `chunkDelayMs` | Wait before every event after the first, `activity` events included; an abort ends the wait |
| `failAfterChunks` | The call rejects with this error after all chunks were sent |
| `waitForAbortAfterChunks` | The call hangs after the chunks until its `AbortSignal` aborts |

The signal is checked between events and after the last chunk, and an aborted call rejects with the signal's reason. For "activity, then silence", use `{ text: '', chunks: [], activityChunks: 1, waitForAbortAfterChunks: true }`: the call sends the activity events and then stays silent until it is aborted.

```typescript
const llm = new ScriptedLLMStrategy('scripted', [
  { text: 'Hello world', chunks: ['Hel', 'lo ', 'world'], activityChunks: 1 }
]);
await llm.generate(request, { onEvent: (event) => events.push(event) });
```

`ScriptedLLMApi` plays the same replies as a provider API, so the real `GenerateCallManager` can run in front of it (queue, retries, streaming hand-over) without a provider. It never sends `request-start`; the call manager does. Its rate limiter always allows a call, and its tokenizer and `extractUsedTokens` return fixed numbers. Give the scripted strategy a call manager strategy (`startScriptedChat` takes it as the `callManagerStrategy` option) and script the API instead of the strategy; a strategy with a call manager strategy refuses replies of its own:

```typescript
const api = new ScriptedLLMApi([{ text: 'Hi there', chunks: ['Hi ', 'there'] }]);
const callManager = new GenerateCallManager<ScriptedLLMCall, ScriptedResponse>(
  'scripted',
  { highPriorityTasksLimit: 10, retryDelay: 1, retryAttemptsLimit: 1 },
  api
);
const llm = new ScriptedLLMStrategy('scripted', [], new NativeCallManagerStrategy(callManager));
```

`api.calls` lists what reached the provider (retries included), while `llm.calls` lists what the strategy was sent. See `integration/src/__tests__/scripted.streaming.test.ts`.

## Package-Level Integration Tests (Docker)

Some packages have their own integration tests requiring Docker:

```bash
cd packages/loft-manifest-s3-strategy
# Create .env.test, then:
pnpm test:local    # Runs Docker, migrations, tests, teardown
```

Each package with Docker tests has:
- `docker-compose-test.yml` — PostgreSQL (or LocalStack, fake-gcs-server, Azurite)
- `.env.test` — Environment variables
- `run_tests.sh` — Orchestration script

See [Database Migrations](../guides/database-migrations.md) for Docker setup details.
