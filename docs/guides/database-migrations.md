# How to Run Database Migrations

LOFT's PostgreSQL repository packages include CLI migration tools for managing database schemas. This guide covers running, rolling back, and troubleshooting migrations.

## Prerequisites

- PostgreSQL 16+ running with schemas created (see [Chat Persistence](./chat-persistence.md))
- `@moc-global/loft-session-pg-repository` and/or `@moc-global/loft-chat-history-pg-repository` installed

## Migration CLI Tools

Each repository package ships a binary:

| Package | CLI Command | Database Schema |
|---------|------------|----------------|
| `@moc-global/loft-session-pg-repository` | `loft-session-pg-migrate` | `loft_session` |
| `@moc-global/loft-chat-history-pg-repository` | `loft-chat-history-pg-migrate` | `loft_chat_history` |

## Environment Setup

Create a `.env` file with your database connection:

```bash
# .env
DATABASE_URL=postgresql://loft_user:loft_pass@localhost:5432/loft_db
DATABASE_SESSION_SCHEMA_NAME=loft_session
DATABASE_CHAT_HISTORY_SCHEMA_NAME=loft_chat_history
```

Or set environment variables directly:

```bash
export DATABASE_URL=postgresql://loft_user:loft_pass@localhost:5432/loft_db
export DATABASE_SESSION_SCHEMA_NAME=loft_session
export DATABASE_CHAT_HISTORY_SCHEMA_NAME=loft_chat_history
```

## Running Migrations

### Migrate to latest

```bash
# Session schema
npx loft-session-pg-migrate to-latest --env .env

# Chat history schema
npx loft-chat-history-pg-migrate to-latest --env .env
```

> **Monorepo note:** If the migration CLIs are workspace dependencies (not globally installed), `npx` may fail with a 404 because they aren't published to npm. In that case, use `pnpm exec` scoped to a package that has the dependency:
>
> ```bash
> pnpm --filter=@moc-global/example-express-full exec loft-session-pg-migrate to-latest
> ```

### Roll back one migration

```bash
npx loft-session-pg-migrate down --env .env
npx loft-chat-history-pg-migrate down --env .env
```

The commands are `up`, `down`, `to <migration-name>`, `to-latest` and `to-current-lib-version`. Without `--env`, the CLI reads `.env.loft-pg-migrations`. Set `DATABASE_SSL=true` in that file to connect over SSL.

### Migrate to a specific version

```bash
npx loft-session-pg-migrate to <migration-name> --env .env
```

## Programmatic Migrations

You can also run migrations from code (useful for test setup):

```typescript
import { runSessionPgMigrations } from '@moc-global/loft-session-pg-repository';
import { runChatHistoryPgMigrations } from '@moc-global/loft-chat-history-pg-repository';
import { Pool } from 'pg';

const pool = new Pool({ /* config */ });

// Run with an existing pool (skips creating a new connection)
await runSessionPgMigrations(
  {
    databaseUrl: 'postgresql://...',
    databaseSsl: false,
    direction: 'to-latest',
    schemaName: 'loft_session',
    libraryVersion: '1.2.5' // used by the 'to-current-lib-version' direction
  },
  pool  // optional — if omitted, creates a new pool from databaseUrl
);

await runChatHistoryPgMigrations(
  {
    databaseUrl: 'postgresql://...',
    databaseSsl: false,
    direction: 'to-latest',
    schemaName: 'loft_chat_history',
    libraryVersion: '1.3.5'
  },
  pool
);
```

The migrations create their tables in the schema given by `schemaName`; they do not read environment variables. The schema must already exist, and its name must be lower-case letters, digits and underscores (at most 63 characters).

## What Migrations Create

### Session Schema (`loft_session`)

The session table stores conversation sessions:

- `id` — UUID primary key (auto-generated via `uuid-ossp`)
- `external_key` — Your application's identifier for the session
- `current_llm_name` — Active LLM strategy name
- `current_manifest_name` — Active manifest name
- `ctx` — JSONB column for custom context data
- `focus_agent` — Name of the session's [Focus](./agents.md) agent, or `NULL` when no Focus is active
- `created_at`, `updated_at` — Timestamps

The `focus_state` table stores the fields a Focus agent has collected, one row per field. `FocusStateStorePg` reads and writes it:

- `session_id` — The session's id, a foreign key to `session.id`. Deleting a session deletes its Focus state
- `agent_name` — The Focus agent that collected the field
- `field_key` — The field's key
- `value` — JSONB value of the field
- Primary key on (`session_id`, `agent_name`, `field_key`), plus an index on (`session_id`, `agent_name`)

| Migration | Change |
|-----------|--------|
| `1.0.0` | `session` table |
| `1.0.2` | `external_key` column with a unique index |
| `1.1.0` | `focus_state` table |
| `1.2.0` | `focus_agent` column |

### Chat History Schema (`loft_chat_history`)

The `message` table stores conversation messages:

- `id` — UUID primary key
- `session_id` — The session's id. There is no foreign key constraint: sessions and history can live in different schemas or databases
- `content` — JSONB array of content parts
- `role` — Message role (user, assistant, system, tool)
- `author` — Message author identifier
- `llm_name` — LLM that generated/received this message
- `manifest_name` — Manifest used for this message
- `ctx` — JSONB column for per-message context
- `sequence_id` — Ordering within session
- `llm_ignore` — Boolean flag to exclude from LLM context
- `created_at`, `updated_at` — Timestamps

| Migration | Change |
|-----------|--------|
| `1.0.0` | `message` table and the `unified_message_role` enum |
| `1.2.0` | `tool` role, `content` changed from text to a JSONB array, `is_archived` renamed to `llm_ignore` |

### Kysely and CamelCase

LOFT uses Kysely ORM with `CamelCasePlugin`. Database columns use `snake_case`, but TypeScript code uses `camelCase`. The plugin handles translation automatically.

## See It in Action

- **[express-full](../../examples/express-full/)** — Uses Docker PostgreSQL with CLI migrations (`loft-session-pg-migrate`, `loft-chat-history-pg-migrate`)
- **[express-basic](../../examples/express-basic/)**, **[express-history](../../examples/express-history/)**, **[nestjs](../../examples/nestjs/)**, **[serverless](../../examples/serverless/)** — Use programmatic migrations via PGLite (auto-migrate at startup, no CLI needed)

## Docker Development Setup

For local development, use Docker Compose:

```yaml
# docker-compose.dev.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: loft_user
      POSTGRES_PASSWORD: loft_pass
      POSTGRES_DB: loft_db
    volumes:
      - ./init-schemas.sql:/docker-entrypoint-initdb.d/init-schemas.sql
      - ./pgdata:/var/lib/postgresql/data
    ports:
      - '5432:5432'
```

```bash
# Start
docker compose -f docker-compose.dev.yml up -d

# Run migrations
npx loft-session-pg-migrate to-latest --env .env
npx loft-chat-history-pg-migrate to-latest --env .env

# Reset (destroy and recreate). Postgres runs init-schemas.sql only when its
# data directory is empty, so deleting ./pgdata makes it run again
docker compose -f docker-compose.dev.yml down
rm -rf ./pgdata
docker compose -f docker-compose.dev.yml up -d
# Re-run migrations after reset
```

## Troubleshooting

### "Schema does not exist"

The migration tool requires the schema to exist before running. Create it manually:

```sql
CREATE SCHEMA IF NOT EXISTS loft_session;
CREATE SCHEMA IF NOT EXISTS loft_chat_history;
```

### "uuid-ossp extension not found"

The `uuid-ossp` extension must be installed in your database:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### Migration lock issues

If a migration was interrupted, Kysely may leave a lock in the migration table. Check and clean up:

```sql
-- Check migration status
SELECT * FROM loft_session.kysely_migration_lock;
-- Unlock if stuck
UPDATE loft_session.kysely_migration_lock SET is_locked = 0;
```
