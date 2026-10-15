# How to Set Up Chat Persistence

This guide shows how to configure storage for sessions and chat history using the built-in PostgreSQL repositories.

> **PostgreSQL is not a hard requirement.** LOFT defines abstract `Repository.Session` and `Repository.ChatHistory` interfaces (in `@moc-global/loft-definitions`) that are database-agnostic. PostgreSQL is supported out of the box via dedicated packages, but you can implement these interfaces for any database (MySQL, MongoDB, DynamoDB, etc.) and pass your custom constructors to `ChatConstructor`. See [Strategy Pattern — Repository Strategies](../concepts/strategy-pattern.md#repository-strategies) for the interface contracts.

## Prerequisites (for PostgreSQL)

- PostgreSQL 16+ running (locally or via Docker)
- `@moc-global/loft-session-pg-repository` installed
- `@moc-global/loft-chat-history-pg-repository` installed
- `pg` package installed

## 1. Create Database Schemas

LOFT uses separate PostgreSQL schemas for sessions and chat history. Create them before running the application:

```sql
-- init-schemas.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA IF NOT EXISTS loft_session;
CREATE SCHEMA IF NOT EXISTS loft_chat_history;
-- Only if you implement a patcher repository (see "Patching messages" below)
CREATE SCHEMA IF NOT EXISTS loft_chat_history_patch;
```

### With Docker

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: loft_user
      POSTGRES_PASSWORD: loft_pass
      POSTGRES_DB: loft_db
    volumes:
      - ./init-schemas.sql:/docker-entrypoint-initdb.d/init-schemas.sql
    ports:
      - '5432:5432'
```

```bash
docker compose up -d
```

## 2. Run Migrations

The repository packages include CLI migration tools:

```bash
# Set environment variables (or use a .env file)
export DATABASE_URL=postgresql://loft_user:loft_pass@localhost:5432/loft_db
export DATABASE_SESSION_SCHEMA_NAME=loft_session
export DATABASE_CHAT_HISTORY_SCHEMA_NAME=loft_chat_history

# Run migrations
npx loft-session-pg-migrate to-latest --env .env
npx loft-chat-history-pg-migrate to-latest --env .env
```

See [Database Migrations](./database-migrations.md) for details on rollback and other commands.

## 3. Configure Repository Constructors

```typescript
import { Pool } from 'pg';
import {
  SessionPostgresDialect,
  SessionRepositoryConstructor
} from '@moc-global/loft-session-pg-repository';
import {
  ChatHistoryPostgresDialect,
  ChatHistoryRepositoryConstructor
} from '@moc-global/loft-chat-history-pg-repository';

// Create a PostgreSQL connection pool
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'loft_db',
  user: 'loft_user',
  password: 'loft_pass'
});

// Session repository
const sessionRepoConstructor = new SessionRepositoryConstructor(
  new SessionPostgresDialect({ pool }),
  { schema: 'loft_session' }
);

// Chat history repository
const chatHistoryRepoConstructor = new ChatHistoryRepositoryConstructor(
  new ChatHistoryPostgresDialect({ pool }),
  { schema: 'loft_chat_history' }
);
```

### Separate Pools

You can use different pools (or even different databases) for sessions and chat history:

```typescript
const sessionPool = new Pool({ /* session db config */ });
const chatHistoryPool = new Pool({ /* chat history db config */ });

const sessionRepoConstructor = new SessionRepositoryConstructor(
  new SessionPostgresDialect({ pool: sessionPool }),
  { schema: 'loft_session' }
);

const chatHistoryRepoConstructor = new ChatHistoryRepositoryConstructor(
  new ChatHistoryPostgresDialect({ pool: chatHistoryPool }),
  { schema: 'loft_chat_history' }
);
```

## 4. Wire Into ChatConstructor

```typescript
import { ChatConstructor } from '@moc-global/loft';

const chatConstructor = new ChatConstructor(
  sessionRepoConstructor,
  chatHistoryRepoConstructor
);
```

Then pass it to `LoftConstructor`:

```typescript
const loftConstructor = new LoftConstructor(
  { logLevel: Interface.LogLevel.INFO },
  manifestManagerConstructor,
  chatConstructor
);
```

## 5. Using Sessions

Once configured, sessions are managed via `loft.chat`:

```typescript
import { Type } from '@moc-global/loft-definitions';

// Create a session
const session = await loft.chat.createSession({
  currentLlmName: 'gpt-4o-mini',
  currentManifestName: 'my-assistant',
  externalKey: { userId: 'user-123' }, // Your app's IDs; lookup needs the same record
  ctx: { locale: 'en-US' }              // Custom session context
});

// Retrieve by ID
const retrieved = await loft.chat.getSessionById(session.id);

// Retrieve by external key
const byKey = await loft.chat.getSessionByExternalKey({ userId: 'user-123' });

// Update session settings
await loft.chat.updateSessionSettings(session.id, 'correlator-1', {
  currentLlmName: 'gpt-4o',                 // Switch LLM
  ctx: { locale: 'fr-FR', premium: true }   // Deep-merged with existing ctx
});

// Delete the session. By design its messages stay in the chat history table.
await loft.chat.deleteSession(session.id);
```

`deleteSession()` removes only the session, and a missing session makes it throw (see [Missing sessions](./error-handling.md#missing-sessions)). The messages are kept on purpose. To erase a conversation as well, for example on a user's deletion request, delete its rows from the chat history table yourself: `DELETE FROM <chat history schema>.message WHERE session_id = $1`.

### Session Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Auto-generated primary key |
| `externalKey` | `Record<string, string \| number \| boolean>` | Your app's identifier (for lookup) |
| `currentLlmName` | string | Default LLM strategy name |
| `currentManifestName` | string | Default manifest name |
| `ctx` | `Record<string, unknown>` | Custom context (deep-merged on update) |
| `createdAt` | Date | Creation timestamp |
| `updatedAt` | Date | Last update timestamp |

## 6. Chat History

`generate()` loads the stored history but does not store anything itself: call `result.messages.save()` to store the turn (see [Multi-turn chat pattern](#multi-turn-chat-pattern)). You can also manage history directly:

```typescript
// Get conversation history
const history = await loft.chat.getChatHistory(session.id);
// history is a QueryByArrayOfObjects<Message> (extends Array<T>)
// Spread for plain JSON: [...history]

// Add messages manually (runs through Input middleware)
await loft.chat.addMessages(session.id, ['correlator-1'], [
  {
    content: [{ type: 'text', text: 'System notice: maintenance in 5 minutes' }],
    role: Type.LLM.UnifiedMessageRole.system,
    author: 'system',
    sessionId: session.id,
    llmName: 'gpt-4o-mini',
    manifestName: 'my-assistant',
    ctx: {},
    llmIgnore: false
  }
]);
```

### Querying history

`getChatHistory()` and `context.chatHistory.messages` (in middleware, prompt computers and interceptors) are arrays of messages with a `query()` method that filters by field:

```typescript
const history = await loft.chat.getChatHistory(session.id);

// Messages from the user since a date
const recentUserMessages = history.query({
  $and: [{ role: { $eq: Type.LLM.UnifiedMessageRole.user } }, { createdAt: { $gte: new Date('2026-10-01') } }]
});

// Fields inside the message's ctx: filter() is simplest in TypeScript
const orderMessages = history.filter((message) => message.ctx.orderId === 'o-1001');
```

| Operators | Meaning |
|-----------|---------|
| `$eq`, `$ne` | Equal, not equal (deep comparison) |
| `$gt`, `$gte`, `$lt`, `$lte` | Compare numbers or dates |
| `$in` | Value is one of a list |
| `$contains` | String or array contains the value |
| `$regex` | Matches a `RegExp` instance; its flags apply, so `/…/i` ignores case |
| `$and`, `$or`, `$nor`, `$not` | Combine conditions |

Always use an operator: a bare value such as `{ role: 'user' }` matches nothing. Matching is case-sensitive unless a regex says otherwise. A field that is missing fails the condition, and there is no `$exists` (an unknown operator throws). The date field is `createdAt`. `query()` returns a plain array.

`query()` also accepts dot paths such as `{ 'ctx.orderId': { $eq: 'o-1001' } }` at runtime, but its TypeScript type allows only top-level fields, so use `filter()` for nested fields in TypeScript code.

### Adding messages from middleware

`context.chatHistory.addMessages(messages)` stores messages and adds them to the in-memory history of the current request. Unlike `loft.chat.addMessages()`, it does not run Input middleware. Every message must have the history's `sessionId`, and an empty array throws.

### Patching messages

Stored messages are never rewritten. A patch is stored separately and applied when the history is read; it can change `ctx`, `content`, `role`, `author`, `llmName`, `manifestName` and `llmIgnore`, and a `ctx` in a patch replaces the whole `ctx`.

Patching needs a `ChatHistoryPatcher` repository. Pass a constructor for it (an `Interface.BaseComponentConstructor<Repository.ChatHistoryPatcher>`, like the session and chat history constructors) as the third argument of `ChatConstructor`; without one, a patch call throws `ChatHistoryPatcherRepository is not provided`. No LOFT package ships a patcher yet, so implement `Repository.ChatHistoryPatcher` from `@moc-global/loft-definitions` against your own storage.

### Multi-turn chat pattern

For multi-turn conversations where the LLM needs to recall previous messages, use `addMessages()` to persist the user message, then `generate()` to get the response (LOFT auto-loads stored history), then `save()` to persist the assistant response:

```typescript
import { Chat, Type } from '@moc-global/loft-definitions';
import crypto from 'crypto';

// loft.chat is typed as ChatInterface | ChatInterfaceWithSMG
// Cast to ChatInterface for addMessages() access (safe with LoftConstructor)
const chat = loft.chat as Chat.ChatInterface;

// 1. Store the user message
const correlatorId = crypto.randomUUID();
await chat.addMessages(sessionId, [correlatorId], [userMessage]);

// 2. Generate — LOFT auto-loads stored history as LLM context
const result = await chat.generate({ sessionId });

// 3. Persist the assistant response
await result.messages.save();
```

> **Concurrency:** LOFT does not serialise requests for the same session. Two `generate()` calls on one session at the same time both run, and each sees the history as it was when it started. If your users can send messages faster than the LLM answers, queue requests per session in your application.

> **Warning:** `directMessages` passed to `generate()` are **transient** — they are used for that single LLM call only and are **not stored** in chat history. If you need the LLM to remember messages across turns, use `addMessages()` to persist them first. The `directMessages` approach is only appropriate for single-turn/ephemeral patterns.

### ChatInterface union type

`loft.chat` is typed as `Chat.ChatInterface | Chat.ChatInterfaceWithSMG`. The `addMessages()` method only exists on `ChatInterface`. When using `LoftConstructor` (sync mode), the instance is always `ChatInterface`, so the cast is safe:

```typescript
const chat = loft.chat as Chat.ChatInterface;
```

Or give the constructor the type once, and `loft.chat` needs no cast:

```typescript
const loftConstructor = new LoftConstructor<Chat.ChatInterface>(loftConfig, manifestManagerConstructor, chatConstructor);
const loft = loftConstructor.getInstance();
await loft.chat.addMessages(sessionId, [correlatorId], [userMessage]);
```

`ChatInterfaceWithSMG` is reserved for execution modes that are not available yet.

## 7. Health Checks

The chat interface includes a built-in health check:

```typescript
const isHealthy = await loft.chat.checkHealth();
```

It returns `true` when every check passes, and stops at the first that fails:

- **Sessions and chat history:** the PostgreSQL repositories check that their schema exists. A connection error counts as unhealthy.
- **LLM strategies:** each strategy asks its call manager. `NativeCallManagerStrategy` always answers healthy, so the provider's API is not called.

Manifest storage is not checked. A strategy registered without a call manager makes `checkHealth()` throw, so wrap it in `try`/`catch`.

## See It in Action

The example applications demonstrate different persistence patterns:

- **[express-basic](../../examples/express-basic/)** — PGLite with ephemeral sessions (stateless, single-turn)
- **[express-history](../../examples/express-history/)** — PGLite with persistent sessions (multi-turn, `addMessages` → `generate` → `save`)
- **[express-full](../../examples/express-full/)** — Docker PostgreSQL with CLI migrations and full session CRUD
- **[serverless](../../examples/serverless/)** — PGLite with module-level caching for Lambda cold-start optimization

## Production Considerations

### Connection Pool Sizing

```typescript
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'loft_db',
  user: 'loft_user',
  password: 'loft_pass',
  max: 20,                    // Max connections in pool
  idleTimeoutMillis: 30000,   // Close idle connections after 30s
  connectionTimeoutMillis: 5000 // Fail fast if can't connect
});
```

### Graceful Shutdown

```typescript
process.on('SIGTERM', async () => {
  // 1. Stop accepting new operations, wait for active ones, then stop the LLM rate-limiter timers
  await loft.shutdown();
  // 2. Flush tracer data (after operations finish, so spans are captured)
  await loftConstructor.gracefulShutdown();
  // 3. Close database connections
  await pool.end();
});
```
