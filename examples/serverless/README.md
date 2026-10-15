# serverless

AWS Lambda + LOFT + OpenAI serverless example with PGLite. Demonstrates how to use LOFT in a Lambda handler with cold-start optimization via module-level caching. No Docker, no external database, no HTTP server.

> **Not for production.** This example has no authentication or authorization and uses demo settings. Use it to learn LOFT, not as a template for a deployed service: add authentication, access checks on sessions, rate limiting and your own error handling first.

## What this example demonstrates

- **Lambda handler shape** — standard `handler(event): Promise<result>` with API Gateway proxy event types
- **Cold-start optimization** — lazy singleton pattern caches LOFT + PGLite at module level across warm invocations
- **Ephemeral session pattern** — create session -> generate -> delete session per invocation (stateless)
- PGLite as a zero-config in-process PostgreSQL (starts automatically, no Docker)
- `LoftConstructor` with `ChatConstructor` wiring (sync mode)
- `OpenAiLoftStrategy` with `GenerateCallManager` and rate limiting
- Zod environment validation at startup
- Local testing via direct handler invocation (no SAM/serverless-offline required)

## Prerequisites

- Node.js 22+
- An OpenAI API key

## Quick start

```bash
# From monorepo root
pnpm install

# Build the example and all its LOFT dependencies
turbo build --filter=@moc-global/example-serverless...

# Set up environment
cp examples/serverless/.env.example examples/serverless/.env
# Edit .env and set your OPENAI_API_KEY

# Run local test (invokes handler with mock event, prints result to stdout)
pnpm run --filter=@moc-global/example-serverless dev
```

## Handler API

The handler expects an API Gateway proxy event with a JSON body:

**Input event:**

```json
{
  "body": "{\"message\": \"What is 2+2?\"}"
}
```

**Success response (200):**

```json
{
  "statusCode": 200,
  "headers": { "Content-Type": "application/json" },
  "body": "{\"response\":\"2 + 2 equals 4.\"}"
}
```

**Error — missing message (400):**

```json
{
  "statusCode": 400,
  "headers": { "Content-Type": "application/json" },
  "body": "{\"error\":\"message is required\"}"
}
```

**Error — malformed JSON (400):**

```json
{
  "statusCode": 400,
  "headers": { "Content-Type": "application/json" },
  "body": "{\"error\":\"Invalid JSON body\"}"
}
```

**Error — internal failure (500):**

```json
{
  "statusCode": 500,
  "headers": { "Content-Type": "application/json" },
  "body": "{\"error\":\"Internal server error\"}"
}
```

## Cold-start considerations

PGLite initialization adds ~1-2 seconds to Lambda cold starts. The lazy singleton pattern (`ensureInitialized()`) amortizes this cost: only the first invocation in a new Lambda container pays the initialization penalty. Subsequent warm invocations reuse the cached LOFT instance.

For production use:
- **Provisioned concurrency** eliminates cold starts entirely
- **Replace PGLite with RDS** — PGLite is for local development; production Lambda should connect to an external PostgreSQL (e.g., RDS with RDS Proxy)
- **Bundle size** — evaluate the final zip size; PGLite adds to the deployment package

## Project structure

```
examples/serverless/
  manifest/
    manifest.json         # LLM manifest (my-assistant / gpt-4o-mini)
    errors/error.json     # Error manifest (empty)
  src/
    handler.ts            # Lambda handler + local test
    config.ts             # Zod env validation
    database.ts           # PGLite init + auto-migration
    loft.ts               # LOFT initialization
  .env.example            # Environment template
  package.json
  tsconfig.json
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | — | Your OpenAI API key |
| `LOFT_LOG_LEVEL` | No | `INFO` | Log level (TRACE, DEBUG, INFO, WARN, ERROR, FATAL, NONE) |
| `LOFT_MANIFEST_PATH` | No | `manifest/manifest.json` | Path to the LLM manifest file |
| `LOFT_MANIFEST_ERROR_PATH` | No | `manifest/errors/error.json` | Path to the error manifest file |
| `LOFT_MANIFEST_CACHE_EXPIRATION` | No | `3600000` | Manifest cache TTL in ms |

## How it works

1. **First invocation (cold start):** `ensureInitialized()` starts PGLite, runs migrations, wires `LoftConstructor` + `ChatConstructor` + `OpenAiLoftStrategy`, caches the instance at module level
2. **Subsequent invocations (warm):** `ensureInitialized()` returns the cached instance immediately
3. **Per-invocation flow:** Parse event body -> validate message -> create ephemeral session -> `generate({ sessionId, directMessages })` -> extract response text -> delete session -> return Lambda response
4. **No shutdown:** Lambda containers are frozen (warm) or destroyed (cold) by AWS. There is no graceful shutdown signal, so no shutdown hooks are needed

## Using as boilerplate

To use this example outside the monorepo:

1. Copy the `examples/serverless/` directory to a new project
2. In `package.json`, replace `workspace:*` with published version numbers (e.g., `"@moc-global/loft": "^2.7.0"`)
3. Replace the PGLite setup in `src/database.ts` with a real PostgreSQL connection (e.g., `pg` + RDS)
4. Run `pnpm install` and follow the `.env.example`
5. Deploy using your preferred framework (SAM, CDK, Serverless Framework)

## Next steps

- **SAM deployment** — add `template.yaml` for AWS SAM
- **CDK deployment** — define the Lambda function as a CDK construct
- **Serverless Framework** — add `serverless.yml` configuration
- **RDS integration** — replace PGLite with RDS + RDS Proxy for production
- **Streaming** — use Lambda response streaming for real-time LLM output
