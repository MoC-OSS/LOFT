# nestjs

NestJS + LOFT + OpenAI example with PGLite. Demonstrates how to integrate LOFT into a NestJS application using standard Module/Service/Controller patterns. No Docker, no external database.

> **Not for production.** This example has no authentication or authorization and uses demo settings. Use it to learn LOFT, not as a template for a deployed service: add authentication, access checks on sessions, rate limiting and your own error handling first.

## What this example demonstrates

- **NestJS Module pattern** — `LoftModule` wraps LOFT as a self-contained, importable NestJS module
- **NestJS Service pattern** — `LoftService` is an `@Injectable()` service encapsulating LOFT initialization and chat operations
- **NestJS Controller pattern** — `ChatController` uses `@Controller()`, `@Post()`, `@Get()` decorators
- **NestJS lifecycle hooks** — `OnModuleInit` for PGLite + LOFT setup, `OnModuleDestroy` for three-step shutdown
- **Dual DI coexistence** — LOFT's Inversify DI and NestJS DI running side by side without conflict
- Multi-turn conversations with persistent sessions (same as express-history)
- PGLite as a zero-config in-process PostgreSQL (starts automatically, no Docker)
- Zod environment validation at startup

## Prerequisites

- Node.js 22.12+ (NestJS 12 is an ES module package, which this CommonJS app loads through `require(esm)`)
- An OpenAI API key

## Quick start

```bash
# From monorepo root
pnpm install

# Build the example and all its LOFT dependencies
turbo build --filter=@moc-global/example-nestjs...

# Set up environment
cp examples/nestjs/.env.example examples/nestjs/.env
# Edit .env and set your OPENAI_API_KEY

# Run (with hot reload via NestJS CLI)
pnpm run --filter=@moc-global/example-nestjs dev

# Or run the compiled output directly
pnpm run --filter=@moc-global/example-nestjs start
```

## API

### GET /chat/health

Basic health check.

**Response (200):**

```json
{ "status": "ok" }
```

### POST /chat/sessions

Create a new chat session. Sessions persist across requests until the server is stopped.

**Request:** No body required.

**Response (201):**

```json
{ "sessionId": "550e8400-e29b-41d4-a716-446655440000" }
```

### POST /chat

Send a message in a session. The LLM receives the full conversation history for multi-turn context.

**Request:**

```json
{ "sessionId": "550e8400-...", "message": "My name is Alex" }
```

**Response (200):**

```json
{
  "sessionId": "550e8400-...",
  "response": "Nice to meet you, Alex!",
  "status": "SUCCESS"
}
```

**Error — missing fields (400):**

```json
{ "message": "sessionId and message are required", "error": "Bad Request", "statusCode": 400 }
```

### GET /chat/sessions/:id/history

View all messages in a session's conversation history.

**Response (200):**

```json
{
  "sessionId": "550e8400-...",
  "messages": [
    { "role": "user", "content": [...], ... },
    { "role": "assistant", "content": [...], ... }
  ]
}
```

## Testing

A test script is included for quick console verification:

```bash
# Run all tests (health, session, chat, multi-turn recall, history, error cases)
./examples/nestjs/test-chat.sh

# Custom port
./examples/nestjs/test-chat.sh 4000
```

Or test manually with curl:

```bash
# Health check
curl -s http://localhost:3004/chat/health | jq .

# Create a session
SESSION=$(curl -s -X POST http://localhost:3004/chat/sessions | jq -r .sessionId)

# Send a message
curl -s -X POST http://localhost:3004/chat \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"$SESSION\", \"message\": \"My name is Alex\"}" | jq .

# Multi-turn recall — proves history works
curl -s -X POST http://localhost:3004/chat \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"$SESSION\", \"message\": \"What is my name?\"}" | jq .response
# Expected: Response contains "Alex"

# View conversation history
curl -s http://localhost:3004/chat/sessions/$SESSION/history | jq .
```

## Project structure

```
examples/nestjs/
  manifest/
    manifest.json         # LLM manifest (my-assistant / gpt-4o-mini)
  src/
    app.module.ts         # Root NestJS module
    loft.module.ts        # LOFT wrapper module (exports LoftService)
    loft.service.ts       # LOFT service (lifecycle hooks, init, chat, shutdown)
    chat.controller.ts    # REST endpoints
    config.ts             # Zod env validation
    database.ts           # PGLite init + auto-migration
    main.ts               # NestFactory bootstrap
  .env.example            # Environment template
  test-chat.sh            # Quick test script
  nest-cli.json           # NestJS CLI config (for dev mode)
  package.json
  tsconfig.json
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | — | Your OpenAI API key |
| `PORT` | No | `3004` | Server port |
| `LOFT_LOG_LEVEL` | No | `INFO` | Log level (TRACE, DEBUG, INFO, WARN, ERROR, FATAL, NONE) |
| `LOFT_SESSION_SCHEMA` | No | `loft_session` | PostgreSQL schema for sessions |
| `LOFT_CHAT_HISTORY_SCHEMA` | No | `loft_chat_history` | PostgreSQL schema for chat history |
| `LOFT_MANIFEST_PATH` | No | `manifest/manifest.json` | Path to the LLM manifest file |
| `LOFT_MANIFEST_ERROR_PATH` | No | `manifest/errors/error.json` | Path to the error manifest file |
| `LOFT_MANIFEST_CACHE_EXPIRATION` | No | `3600000` | Manifest cache TTL in ms |

## How it works

1. **Bootstrap:** `main.ts` creates the NestJS app with `enableShutdownHooks()` so SIGINT/SIGTERM triggers `onModuleDestroy`
2. **Service init:** `LoftService.onModuleInit()` calls `initialize()` which starts PGLite, runs migrations, and wires LOFT
3. **LOFT wiring:** `LoftService` creates `ChatConstructor` (session + chat history repos), `ManifestManager` (filesystem), `LoftConstructor` (DI container), and registers `OpenAiLoftStrategy` (gpt-4o-mini)
4. **Session creation:** `POST /chat/sessions` → `LoftService.createSession()` → `loft.chat.createSession()`
5. **Chat flow:** `POST /chat` → `LoftService.sendMessage()` → stores user message via `addMessages()` → `generate({ sessionId })` (auto-loads history) → `save()` persists response
6. **History:** `GET /chat/sessions/:id/history` → `LoftService.getChatHistory()` → `loft.chat.getChatHistory()`
7. **Shutdown:** SIGINT/SIGTERM → NestJS lifecycle → `LoftService.onModuleDestroy()` → two-step shutdown: `loft.shutdown()` (which also shuts the tracer down) → `db.close()`

## NestJS + LOFT DI — how they coexist

LOFT uses **Inversify** for its internal dependency injection (managing LLM strategies, middleware managers, repositories). NestJS has its own DI container (managing modules, services, controllers).

These two DI systems do not interact. `LoftService` is the boundary:
- **NestJS DI** manages `LoftService`, `ChatController`, and module lifecycle
- **Inversify DI** (inside `LoftConstructor`) manages LOFT's internal components

You never need to register LOFT's internal bindings in NestJS's DI, or vice versa. `LoftService` wraps the LOFT instance and exposes domain methods (`createSession`, `sendMessage`, `getChatHistory`) — controllers only interact with these.

## Build tooling note

This example uses `tsc` for builds and `nest start --watch` for development, unlike the Express examples which use `tsup`/`tsx`. This is because NestJS requires `emitDecoratorMetadata` (TypeScript compiler option) for its DI to resolve constructor parameters. `tsup` and `tsx` use `esbuild` which does not support this option.

## Using as boilerplate

To use this example outside the monorepo:

1. Copy the `examples/nestjs/` directory to a new project
2. In `package.json`, replace `workspace:*` with published version numbers (e.g., `"@moc-global/loft": "^2.7.0"`)
3. Run `pnpm install` and follow the `.env.example`

## Next steps

- **serverless** (coming soon) — LOFT in an AWS Lambda handler with cold-start optimization
