# LOFT Examples

Runnable example applications demonstrating LOFT framework integration patterns.
Each example builds on the previous, showing progressively more features.

> **Not for production.** The examples have no authentication or authorization; in those that keep sessions, anyone who can reach the server can read or delete any session by its id. `docker-compose.yml` uses a demo password and publishes Postgres on 127.0.0.1 only. Use the examples to learn LOFT, not as templates for a deployed service. They also answer an unknown or malformed session id with 500; a real API should handle missing sessions (see [Missing sessions](../docs/guides/error-handling.md#missing-sessions)).

## Examples — Ordered by Complexity

| # | Example | User Story | DB | Provider | Setup Time |
|---|---------|------------|-----|----------|------------|
| 1 | [express-basic](./express-basic/) | Send a message, get a response | PGLite (auto) | OpenAI | ~2 min |
| 2 | [express-history](./express-history/) | Multi-turn conversations with memory | PGLite | OpenAI | ~3 min |
| 3 | [express-full](./express-full/) | Production-like: middleware, CRUD, dynamic prompts | Docker PG | Anthropic | ~10 min |
| 4 | [nestjs](./nestjs/) | LOFT inside a NestJS application | PGLite | OpenAI | ~3 min |
| 5 | [serverless](./serverless/) | LOFT in an AWS Lambda handler | PGLite (auto) | OpenAI | ~2 min |
| 6 | [express-focus-basic](./express-focus-basic/) | Focus: collect a pizza order over several turns | Docker PG | Anthropic | ~10 min |
| 7 | [express-agents](./express-agents/) | Agent graphs, fan-out and teams (restaurant showcase) | Docker PG | Anthropic | ~10 min |

### What's PGLite?

PGLite is an in-process PostgreSQL implementation ([`@electric-sql/pglite`](https://pglite.dev), served to `pg` through `@electric-sql/pglite-socket`; see each example's `src/database.ts`). It starts automatically when the example boots — no Docker, no external database, no setup. Data lives in memory and is lost when the process exits. It's ideal for development and learning.

### Which example should I start with?

- **New to LOFT?** Start with `express-basic` → then `express-history`
- **Want to see everything?** Go straight to `express-full`
- **NestJS user?** Start with `nestjs`
- **Serverless?** Start with `serverless`
- **Multi-agent workflows?** Start with `express-focus-basic` → then `express-agents`

## Quick Start (any example)

```bash
# From monorepo root
pnpm install

# Build the example and its LOFT dependencies
turbo build --filter=@moc-global/example-express-basic...

# Copy env template and set your API key
cp examples/.env.example examples/express-basic/.env
# Edit .env → set OPENAI_API_KEY

# Run
pnpm run --filter=@moc-global/example-express-basic dev
```

The `...` suffix in the turbo filter builds the example AND all its workspace dependencies.

## For express-full Only (Docker PostgreSQL)

```bash
cd examples
docker compose up -d
cd ..

# Build express-full and all its LOFT dependencies (includes migration CLIs)
turbo build --filter=@moc-global/example-express-full...

# Run database migrations
DATABASE_URL=postgresql://loft_example:loft_example_pass@localhost:5433/loft_examples \
DATABASE_SESSION_SCHEMA_NAME=loft_session \
pnpm --filter=@moc-global/example-express-full exec loft-session-pg-migrate to-latest

DATABASE_URL=postgresql://loft_example:loft_example_pass@localhost:5433/loft_examples \
DATABASE_CHAT_HISTORY_SCHEMA_NAME=loft_chat_history \
pnpm --filter=@moc-global/example-express-full exec loft-chat-history-pg-migrate to-latest
```

## Using Examples as Boilerplate

Each example can be copied out of the monorepo:

1. Copy the example directory to a new project
2. In `package.json`, replace `workspace:*` with version numbers (e.g., `"@moc-global/loft": "^2.7.0"`)
3. Run `pnpm install` and follow the example's `.env.example`
