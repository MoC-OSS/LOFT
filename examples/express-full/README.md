# express-full

Full-featured Express + LOFT + Anthropic example with Docker PostgreSQL, middleware pipeline (all 3 stages), GM computer for dynamic system messages, and full session CRUD. Shows how LOFT integrates in a real-world setup.

> **Not for production.** This example has no authentication or authorization and uses demo settings. Use it to learn LOFT, not as a template for a deployed service: add authentication, access checks on sessions, rate limiting and your own error handling first.

## What this example demonstrates

- `LoftConstructor` with `ChatConstructor` wiring (sync mode)
- `ManifestManagerConstructor` with filesystem-based manifest
- `AnthropicLoftStrategy` with `GenerateCallManager` and rate limiting
- **Docker PostgreSQL** — real database with CLI-based migrations (not PGLite)
- **Middleware pipeline** — InputMiddleware, BeforeGenerateMiddleware, AfterGenerateMiddleware with console logging
- **GM Computer** — dynamic system message augmentation (appends current UTC timestamp)
- **Full session CRUD** — create, get by ID, delete
- **Multi-turn context** — LOFT automatically replays chat history to the LLM on each generate call
- Zod environment validation at startup
- Two-step graceful shutdown with re-entrancy guard via SIGINT/SIGTERM

## Prerequisites

- Node.js 22.12+
- Docker (for PostgreSQL)
- An Anthropic API key

## Quick start

```bash
# From monorepo root
pnpm install

# Start Docker PostgreSQL
cd examples && docker compose up -d && cd ..

# Build the migration CLIs and all LOFT dependencies
pnpm turbo build --filter=@moc-global/example-express-full...

# Run database migrations
DATABASE_URL=postgresql://loft_example:loft_example_pass@localhost:5433/loft_examples \
DATABASE_SESSION_SCHEMA_NAME=loft_session \
pnpm --filter=@moc-global/example-express-full exec loft-session-pg-migrate to-latest

DATABASE_URL=postgresql://loft_example:loft_example_pass@localhost:5433/loft_examples \
DATABASE_CHAT_HISTORY_SCHEMA_NAME=loft_chat_history \
pnpm --filter=@moc-global/example-express-full exec loft-chat-history-pg-migrate to-latest

# Set up environment
cp examples/express-full/.env.example examples/express-full/.env
# Edit .env and set your ANTHROPIC_API_KEY

# Run (with hot reload)
pnpm run --filter=@moc-global/example-express-full dev

# Or run without hot reload
pnpm run --filter=@moc-global/example-express-full start
```

## API

### GET /health

Health check endpoint.

**Response (200):**

```json
{ "status": "ok" }
```

### POST /api/sessions

Create a new chat session.

**Request:** No body required.

**Response (200):**

```json
{ "sessionId": "550e8400-e29b-41d4-a716-446655440000" }
```

### GET /api/sessions/:id

Get session information.

**Response (200):**

```json
{ "id": "550e8400-...", "currentLlmName": "claude-sonnet-5-5", ... }
```

### GET /api/sessions/:id/history

The stored conversation: the user messages and the assistant replies.

**Response (200):**

```json
{ "sessionId": "550e8400-...", "messages": [{ "role": "user", "content": [{ "type": "text", "text": "..." }], ... }] }
```

### DELETE /api/sessions/:id

Delete a session. By design `deleteSession()` removes only the session; its messages stay in the chat history table.

**Response (200):**

```json
{ "deleted": true }
```

### POST /api/chat

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
{ "error": "sessionId and message are required" }
```

## Middleware pipeline

When a message is sent via `POST /api/chat`, the server console shows the middleware pipeline in action:

```
[InputMiddleware] Processing 1 message(s)          ← from addMessages()
[InputMiddleware] Processing 1 message(s)          ← from generate()
[BeforeGenerateMiddleware] Session: <session-id>
[AfterGenerateMiddleware] Response received
```

**Note:** InputMiddleware fires twice per chat request — once during `chat.addMessages()` (storing the user message) and once during `chat.generate()` (before the LLM call). This is expected LOFT behavior.

## GM Computer

The GM Computer appends the current UTC timestamp to the system message on every `generate()` call. The LLM sees:

```
You are a helpful assistant. Be concise and clear in your responses.
Current time: 2026-03-27T15:30:00.000Z
```

This demonstrates dynamic prompt augmentation without modifying the manifest file.

## Testing

A test script is included for quick console verification:

```bash
# Run all tests (health, CRUD, chat, multi-turn recall, error cases)
./examples/express-full/test-chat.sh

# Custom port
./examples/express-full/test-chat.sh 4000
```

Or test manually with curl:

```bash
# Health check
curl -s http://localhost:3003/health | jq .

# Create a session
SESSION=$(curl -s -X POST http://localhost:3003/api/sessions | jq -r .sessionId)

# Send a message
curl -s -X POST http://localhost:3003/api/chat \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"$SESSION\", \"message\": \"My name is Alex\"}" | jq .

# Multi-turn recall — proves history works
curl -s -X POST http://localhost:3003/api/chat \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"$SESSION\", \"message\": \"What is my name?\"}" | jq .response

# Get session info
curl -s http://localhost:3003/api/sessions/$SESSION | jq .

# Conversation history
curl -s http://localhost:3003/api/sessions/$SESSION/history | jq '.messages[] | {role, text: .content[0].text}'

# Delete session
curl -s -X DELETE http://localhost:3003/api/sessions/$SESSION | jq .
```

## Project structure

```
examples/express-full/
  manifest/
    manifest.json       # LLM manifest (my-assistant / claude-sonnet-5-5)
  src/
    config.ts           # Zod env validation (Anthropic key + Postgres config)
    database.ts         # pg.Pool creation from env config
    middleware.ts       # All 3 middleware functions (input, before-generate, after-generate)
    loft.ts             # LOFT wiring (Anthropic strategy, middleware, GM computer)
    index.ts            # Express server, 6 endpoints, shutdown
  .env.example          # Environment template
  test-chat.sh          # Quick test script
  package.json
  tsconfig.json
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | Your Anthropic API key |
| `POSTGRES_HOST` | No | `localhost` | PostgreSQL host |
| `POSTGRES_PORT` | No | `5433` | PostgreSQL port |
| `POSTGRES_USER` | No | `loft_example` | PostgreSQL user |
| `POSTGRES_PASSWORD` | No | `loft_example_pass` | PostgreSQL password |
| `POSTGRES_DB` | No | `loft_examples` | PostgreSQL database |
| `PORT` | No | `3003` | Server port |
| `LOFT_LOG_LEVEL` | No | `INFO` | Log level (TRACE, DEBUG, INFO, WARN, ERROR, FATAL, NONE) |
| `LOFT_SESSION_SCHEMA` | No | `loft_session` | PostgreSQL schema for sessions |
| `LOFT_CHAT_HISTORY_SCHEMA` | No | `loft_chat_history` | PostgreSQL schema for chat history |
| `LOFT_MANIFEST_PATH` | No | `manifest/manifest.json` | Path to the LLM manifest file |
| `LOFT_MANIFEST_ERROR_PATH` | No | `manifest/errors/error.json` | Path to the error manifest file |
| `LOFT_MANIFEST_CACHE_EXPIRATION` | No | `3600000` | Manifest cache TTL in ms |

## How it works

1. **Docker PostgreSQL:** Start with `docker compose up -d` from `examples/`. The `init-db.sql` creates schemas and extensions on first boot.
2. **CLI Migrations:** Run `pnpm --filter=@moc-global/example-express-full exec loft-session-pg-migrate to-latest` and `pnpm --filter=@moc-global/example-express-full exec loft-chat-history-pg-migrate to-latest` with `DATABASE_URL` and schema env vars. This creates tables in the PostgreSQL schemas.
3. **LOFT init:** `LoftConstructor` binds the DI container with `ChatConstructor` (session + chat history repos with middleware), `ManifestManager` (filesystem), `AnthropicLoftStrategy` (Claude Sonnet), and a GM computer for timestamp augmentation.
4. **Session CRUD:** `POST /api/sessions` creates, `GET /api/sessions/:id` retrieves, `GET /api/sessions/:id/history` lists the stored messages, `DELETE /api/sessions/:id` deletes sessions.
5. **Chat flow:** `POST /api/chat` stores the user message via `chat.addMessages()`, then calls `chat.generate({ sessionId })` which auto-loads stored history as LLM context, then persists the response via `result.messages.save()`.
6. **Middleware:** InputMiddleware logs on both `addMessages()` and `generate()`, BeforeGenerateMiddleware logs session ID, AfterGenerateMiddleware logs response receipt.
7. **Shutdown:** SIGINT/SIGTERM triggers two-step shutdown with re-entrancy guard: `loft.shutdown()` (which also shuts the tracer down) -> `pool.end()`.

## Changing the LLM model

To use a different Anthropic model, update three places:

1. `manifest/manifest.json` — change the key and `modelPreset.model`
2. `src/loft.ts` — change `MODEL_NAME` constant
3. `src/index.ts` — change `currentLlmName` and `llmName` in session creation and message objects

## Using as boilerplate

To use this example outside the monorepo:

1. Copy the `examples/express-full/` directory to a new project
2. In `package.json`, replace `workspace:*` with published version numbers (e.g., `"@moc-global/loft": "^2.10.0"`)
3. Set up your own PostgreSQL (or use the Docker Compose from `examples/`)
4. Run `pnpm install` and follow the `.env.example`

## Next steps

- **[nestjs](../nestjs/)** — LOFT inside a NestJS application with Module/Service/Controller pattern
- **[serverless](../serverless/)** — LOFT in an AWS Lambda handler with cold-start optimization

## Stopping Docker PostgreSQL

```bash
cd examples
docker compose down          # Stop and remove containers (data persists in volume)
docker compose down -v       # Stop and remove containers AND data volume
```
