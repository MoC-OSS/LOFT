# express-basic

Minimal stateless Express + LOFT + OpenAI example. Send a message, get a response. No sessions, no external database, no middleware.

> **Not for production.** This example has no authentication or authorization and uses demo settings. Use it to learn LOFT, not as a template for a deployed service: add authentication, access checks on sessions, rate limiting and your own error handling first.

## What this example demonstrates

- `LoftConstructor` with `ChatConstructor` wiring (sync mode)
- `ManifestManagerConstructor` with filesystem-based manifest
- `OpenAiLoftStrategy` with `GenerateCallManager` and rate limiting
- PGLite as a zero-config in-process PostgreSQL (starts automatically, no Docker)
- Zod environment validation at startup
- Graceful shutdown via SIGINT/SIGTERM

## Prerequisites

- Node.js 22.12+
- An OpenAI API key

## Quick start

```bash
# From monorepo root
pnpm install

# Build the example and all its LOFT dependencies
pnpm turbo build --filter=@moc-global/example-express-basic...

# Set up environment
cp examples/express-basic/.env.example examples/express-basic/.env
# Edit .env and set your OPENAI_API_KEY

# Run (with hot reload)
pnpm run --filter=@moc-global/example-express-basic dev

# Or run without hot reload
pnpm run --filter=@moc-global/example-express-basic start
```

## API

### POST /chat

Send a message and receive an LLM response. Each request is independent (stateless).

**Request:**

```json
{ "message": "What is 2+2?" }
```

**Response (200):**

```json
{ "response": "2 + 2 equals 4." }
```

**Error — missing message (400):**

```json
{ "error": "message is required" }
```

**Error — LLM failure (500):**

```json
{ "error": "Internal server error" }
```

The details stay in the server log (`Chat error: ...`).

## Testing

A test script is included for quick console verification:

```bash
# Run all tests (valid request, missing message, empty message)
./examples/express-basic/test-chat.sh

# Custom message
./examples/express-basic/test-chat.sh "What is the capital of France?"

# Custom message + custom port
./examples/express-basic/test-chat.sh "Hello" 4000
```

Or test manually with curl:

```bash
curl -s -X POST http://localhost:3001/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "What is 2+2?"}' | jq .
```

## Project structure

```
examples/express-basic/
  manifest/
    manifest.json       # LLM manifest (my-assistant / gpt-4o-mini)
  src/
    config.ts           # Zod env validation
    database.ts         # PGLite init + auto-migration
    loft.ts             # LOFT wiring (ChatConstructor, OpenAI strategy)
    index.ts            # Express server, POST /chat endpoint
  .env.example          # Environment template
  test-chat.sh          # Quick test script
  package.json
  tsconfig.json
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | — | Your OpenAI API key |
| `PORT` | No | `3001` | Server port |
| `LOFT_LOG_LEVEL` | No | `INFO` | Log level (TRACE, DEBUG, INFO, WARN, ERROR, FATAL, NONE) |
| `LOFT_MANIFEST_PATH` | No | `manifest/manifest.json` | Path to the LLM manifest file |
| `LOFT_MANIFEST_ERROR_PATH` | No | `manifest/errors/error.json` | Path to the error manifest file |
| `LOFT_MANIFEST_CACHE_EXPIRATION` | No | `3600000` | Manifest cache TTL in ms |

## How it works

1. **Startup:** PGLite starts an in-process PostgreSQL, runs session and chat history migrations automatically
2. **LOFT init:** `LoftConstructor` binds the DI container with `ChatConstructor` (session + chat history repos), `ManifestManager` (filesystem), and `OpenAiLoftStrategy` (gpt-4o-mini)
3. **Request flow:** Each `POST /chat` creates an ephemeral session, sends the user message via `loft.chat.generate()`, extracts the response text, deletes the session, and returns the result
4. **Shutdown:** SIGINT/SIGTERM triggers two-step shutdown: `loft.shutdown()` (which also shuts the tracer down) → `db.close()`

## Using as boilerplate

To use this example outside the monorepo:

1. Copy the `examples/express-basic/` directory to a new project
2. In `package.json`, replace `workspace:*` with published version numbers (e.g., `"@moc-global/loft": "^2.10.0"`)
3. Run `pnpm install` and follow the `.env.example`

## Next steps

- **[express-history](../express-history/)** — Multi-turn conversations with session persistence
- **[express-full](../express-full/)** — Middleware pipeline, dynamic prompts, Docker PostgreSQL
