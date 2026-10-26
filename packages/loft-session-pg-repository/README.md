# @moc-global/loft-session-pg-repository

Stores [LOFT](https://github.com/MoC-OSS/LOFT) chat sessions in PostgreSQL. A session holds the current LLM name, manifest name and your context (`ctx`). The package ships its migrations, a migration CLI (`loft-session-pg-migrate`) and a function that runs them from code.

## Install

```bash
npm install @moc-global/loft-session-pg-repository pg
```

Its peers, `@moc-global/loft-definitions`, `inversify` 6, `reflect-metadata` and `zod` 3, are already in a LOFT application. It uses [Kysely](https://kysely.dev) with the `pg` driver.

## Set up the database

The migrations need an existing schema and the `uuid-ossp` extension:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA IF NOT EXISTS loft_session;
```

Then run the migrations, either with the CLI:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/app \
DATABASE_SESSION_SCHEMA_NAME=loft_session \
npx loft-session-pg-migrate to-latest
```

or from code, for example when the application starts:

```typescript
import { runSessionPgMigrations } from '@moc-global/loft-session-pg-repository';

export async function migrateSessions(databaseUrl: string) {
  await runSessionPgMigrations({
    databaseUrl,
    direction: 'to-latest',
    schemaName: 'loft_session',
    libraryVersion: '2.0.0' // used only by the to-current-lib-version direction
  });
}
```

## Usage

Pass a `SessionRepositoryConstructor` as the first argument of `ChatConstructor`:

```typescript
import 'reflect-metadata';

import { ChatConstructor } from '@moc-global/loft';
import {
  ChatHistoryPostgresDialect,
  ChatHistoryRepositoryConstructor
} from '@moc-global/loft-chat-history-pg-repository';
import { SessionPostgresDialect, SessionRepositoryConstructor } from '@moc-global/loft-session-pg-repository';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const chatConstructor = new ChatConstructor(
  new SessionRepositoryConstructor(new SessionPostgresDialect({ pool }), { schema: 'loft_session' }),
  new ChatHistoryRepositoryConstructor(new ChatHistoryPostgresDialect({ pool }), { schema: 'loft_chat_history' })
);
```

Sessions and chat history can share a pool and a database; each needs its own schema.

## Configuration

| | Field | What it sets |
| --- | --- | --- |
| `SessionRepositoryConstructor` | `{ schema }` | The schema that holds the sessions table |
| CLI and `runSessionPgMigrations` | `databaseUrl` (`DATABASE_URL`) | The database to migrate |
| | `schemaName` (`DATABASE_SESSION_SCHEMA_NAME`) | An existing schema; lower-case letters, digits and underscores |
| | `databaseSsl` (`DATABASE_SSL`) | Connect over SSL; default `false` |
| | `direction` | `up`, `down`, `to` (with `migrationName`), `to-latest` or `to-current-lib-version` |
| | `libraryVersion` | The version `to-current-lib-version` migrates to; the CLI uses the installed package version |

The CLI reads the variables from the environment, or from a file given with `--env` (default `.env.loft-pg-migrations`). `runSessionPgMigrations` takes an existing `pg` pool as an optional second argument.

`FocusStateStorePg` stores [Focus](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/agents.md) state in the same schema. It takes a Kysely instance with `CamelCasePlugin` and the schema name.

## Documentation

- [Chat persistence](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/chat-persistence.md)
- [Database migrations](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/database-migrations.md)

## License

[MIT](./LICENSE)
