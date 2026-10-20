# express-history

Multi-turn Express + LOFT + OpenAI example with PGLite. Send messages in a session and the LLM remembers previous conversation. No Docker, no external database.

> **Not for production.** This example has no authentication or authorization and uses demo settings. Use it to learn LOFT, not as a template for a deployed service: add authentication, access checks on sessions, rate limiting and your own error handling first.

## What this example demonstrates

- `LoftConstructor` with `ChatConstructor` wiring (sync mode)
- `ManifestManagerConstructor` with filesystem-based manifest
- `OpenAiLoftStrategy` with `GenerateCallManager` and rate limiting
- **Persistent sessions** — sessions survive across requests (unlike express-basic's ephemeral pattern)
- **Multi-turn context** — LOFT automatically replays chat history to the LLM on each generate call
- **Chat history retrieval** via `loft.chat.getChatHistory()`
- PGLite as a zero-config in-process PostgreSQL (starts automatically, no Docker)
- Zod environment validation at startup
- Two-step graceful shutdown via SIGINT/SIGTERM

## Prerequisites

- Node.js 22.12+
- An OpenAI API key

## Quick start

```bash
# From monorepo root
pnpm install

# Build the example and all its LOFT dependencies
turbo build --filter=@moc-global/example-express-history...

# Set up environment
cp examples/express-history/.env.example examples/express-history/.env
# Edit .env and set your OPENAI_API_KEY

# Run (with hot reload)
pnpm run --filter=@moc-global/example-express-history dev

# Or run without hot reload
pnpm run --filter=@moc-global/example-express-history start
```

## API

### POST /sessions

Create a new chat session. Sessions persist across requests until the server is stopped.

**Request:** No body required.

**Response (200):**

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
{ "error": "sessionId and message are required" }
```

### GET /sessions/:id/history

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
# Run all tests (session creation, chat, multi-turn recall, history, error cases)
./examples/express-history/test-chat.sh

# Custom port
./examples/express-history/test-chat.sh 4000
```

Or test manually with curl:

```bash
# Create a session
SESSION=$(curl -s -X POST http://localhost:3002/sessions | jq -r .sessionId)

# Send a message
curl -s -X POST http://localhost:3002/chat \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"$SESSION\", \"message\": \"My name is Alex\"}" | jq .

# Multi-turn recall — proves history works
curl -s -X POST http://localhost:3002/chat \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"$SESSION\", \"message\": \"What is my name?\"}" | jq .response
# Expected: Response contains "Alex"

# View conversation history
curl -s http://localhost:3002/sessions/$SESSION/history | jq .
```

## Project structure

```
examples/express-history/
  manifest/
    manifest.json       # LLM manifest (my-assistant / gpt-4o-mini)
  src/
    config.ts           # Zod env validation
    database.ts         # PGLite init + auto-migration
    loft.ts             # LOFT wiring (ChatConstructor, OpenAI strategy)
    index.ts            # Express server, 3 endpoints
  .env.example          # Environment template
  test-chat.sh          # Quick test script
  package.json
  tsconfig.json
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | — | Your OpenAI API key |
| `PORT` | No | `3002` | Server port |
| `LOFT_LOG_LEVEL` | No | `INFO` | Log level (TRACE, DEBUG, INFO, WARN, ERROR, FATAL, NONE) |
| `LOFT_SESSION_SCHEMA` | No | `loft_session` | PostgreSQL schema for sessions |
| `LOFT_CHAT_HISTORY_SCHEMA` | No | `loft_chat_history` | PostgreSQL schema for chat history |
| `LOFT_MANIFEST_PATH` | No | `manifest/manifest.json` | Path to the LLM manifest file |
| `LOFT_MANIFEST_ERROR_PATH` | No | `manifest/errors/error.json` | Path to the error manifest file |
| `LOFT_MANIFEST_CACHE_EXPIRATION` | No | `3600000` | Manifest cache TTL in ms |

## How it works

1. **Startup:** PGLite starts an in-process PostgreSQL, runs session and chat history migrations automatically
2. **LOFT init:** `LoftConstructor` binds the DI container with `ChatConstructor` (session + chat history repos), `ManifestManager` (filesystem), and `OpenAiLoftStrategy` (gpt-4o-mini)
3. **Session creation:** `POST /sessions` calls `loft.chat.createSession()` — sessions persist in PGLite
4. **Chat flow:** `POST /chat` stores the user message via `chat.addMessages()`, then calls `chat.generate({ sessionId })` which auto-loads stored history as LLM context, then persists the response via `result.messages.save()`
5. **History:** `GET /sessions/:id/history` calls `loft.chat.getChatHistory()` to retrieve all stored messages
6. **Shutdown:** SIGINT/SIGTERM triggers two-step shutdown: `loft.shutdown()` (which also shuts the tracer down) → `db.close()`

## Using as boilerplate

To use this example outside the monorepo:

1. Copy the `examples/express-history/` directory to a new project
2. In `package.json`, replace `workspace:*` with published version numbers (e.g., `"@moc-global/loft": "^2.7.0"`)
3. Run `pnpm install` and follow the `.env.example`

## Next steps

- **[express-full](../express-full/)** — Middleware pipeline, dynamic prompts, Docker PostgreSQL, Anthropic
