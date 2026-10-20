import { runChatHistoryPgMigrations } from '@moc-global/loft-chat-history-pg-repository';
import { PGLiteInstanceFactory, PGLiteUtils } from '@moc-global/loft-pglite';
import { runSessionPgMigrations } from '@moc-global/loft-session-pg-repository';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Different from the schema names in .env.test, so the test fails if a migration reads the environment
const SESSION_SCHEMA = 'migration_test_session';
const CHAT_HISTORY_SCHEMA = 'migration_test_chat_history';
const LIB_VERSION_SCHEMA = 'migration_test_lib_version';
const LIB_VERSION_CHAT_SCHEMA = 'migration_test_lib_version_chat';

describe('Postgres migrations', () => {
  let pgliteInstance: Awaited<ReturnType<typeof PGLiteInstanceFactory.create>>;
  let pool: Pool;
  let databaseUrl: string;

  async function appliedMigrations(schema: string): Promise<string[]> {
    const { rows } = await pool.query<{ name: string }>(`SELECT name FROM ${schema}.kysely_migration ORDER BY name`);
    return rows.map((row) => row.name);
  }

  async function sessionColumns(schema: string): Promise<string[]> {
    const { rows } = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'session'",
      [schema]
    );
    return rows.map((row) => row.column_name);
  }

  async function tablesIn(schema: string): Promise<string[]> {
    const { rows } = await pool.query<{ table_name: string }>(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
      [schema]
    );
    return rows.map((row) => row.table_name);
  }

  beforeAll(async () => {
    pgliteInstance = await PGLiteInstanceFactory.create();
    pool = PGLiteUtils.createPool(pgliteInstance);
    databaseUrl = pgliteInstance.connectionString;
    await PGLiteUtils.createSchemas(pool, [
      SESSION_SCHEMA,
      CHAT_HISTORY_SCHEMA,
      LIB_VERSION_SCHEMA,
      LIB_VERSION_CHAT_SCHEMA
    ]);
    await PGLiteUtils.createExtensions(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await pgliteInstance?.close();
  });

  it('creates the session tables in the schema given by schemaName', async () => {
    await runSessionPgMigrations(
      { databaseUrl, databaseSsl: false, direction: 'to-latest', schemaName: SESSION_SCHEMA, libraryVersion: '1.2.0' },
      pool
    );

    expect(await tablesIn(SESSION_SCHEMA)).toEqual([
      'focus_state',
      'kysely_migration',
      'kysely_migration_lock',
      'session'
    ]);
  });

  it('creates the chat history tables in the schema given by schemaName', async () => {
    await runChatHistoryPgMigrations(
      {
        databaseUrl,
        databaseSsl: false,
        direction: 'to-latest',
        schemaName: CHAT_HISTORY_SCHEMA,
        libraryVersion: '1.2.0'
      },
      pool
    );

    expect(await tablesIn(CHAT_HISTORY_SCHEMA)).toEqual(['kysely_migration', 'kysely_migration_lock', 'message']);
    const { rows } = await pool.query<{ role: string }>(
      `SELECT unnest(enum_range(NULL::${CHAT_HISTORY_SCHEMA}.unified_message_role))::text AS role`
    );
    expect(rows.map((row) => row.role)).toContain('tool');
  });

  it('migrates down in the same schema', async () => {
    await runSessionPgMigrations(
      { databaseUrl, databaseSsl: false, direction: 'down', schemaName: SESSION_SCHEMA, libraryVersion: '1.2.0' },
      pool
    );

    // 1.2.0 added focus_agent; migrating down one step removes it
    expect(await sessionColumns(SESSION_SCHEMA)).not.toContain('focus_agent');
  });

  it('rejects a schema that does not exist instead of exiting the process', async () => {
    await expect(
      runSessionPgMigrations(
        {
          databaseUrl,
          databaseSsl: false,
          direction: 'to-latest',
          schemaName: 'no_such_schema',
          libraryVersion: '1.2.0'
        },
        pool
      )
    ).rejects.toThrow('Schema "no_such_schema" does not exist in the database');
  });

  it('rejects a schema name that is not a plain identifier', async () => {
    await expect(
      runSessionPgMigrations(
        {
          databaseUrl,
          databaseSsl: false,
          direction: 'to-latest',
          schemaName: 'public; DROP TABLE x',
          libraryVersion: '1.2.0'
        },
        pool
      )
    ).rejects.toThrow('Schema name must be lower-case letters, digits and underscores');
  });

  describe('to-current-lib-version', () => {
    const migrateSession = (direction: 'to-current-lib-version' | 'up', libraryVersion: string) =>
      runSessionPgMigrations(
        { databaseUrl, databaseSsl: false, direction, schemaName: LIB_VERSION_SCHEMA, libraryVersion },
        pool
      );

    it('migrates to the newest migration at or below the library version', async () => {
      await migrateSession('to-current-lib-version', '1.1.4');

      expect(await appliedMigrations(LIB_VERSION_SCHEMA)).toEqual(['1.0.0', '1.0.2', '1.1.0']);
      expect(await sessionColumns(LIB_VERSION_SCHEMA)).not.toContain('focus_agent');
    });

    it('migrates up one step from there', async () => {
      await migrateSession('up', '1.1.4');

      expect(await appliedMigrations(LIB_VERSION_SCHEMA)).toEqual(['1.0.0', '1.0.2', '1.1.0', '1.2.0']);
      expect(await sessionColumns(LIB_VERSION_SCHEMA)).toContain('focus_agent');
    });

    it('migrates back down when the database is ahead of the library version', async () => {
      await migrateSession('to-current-lib-version', '1.1.4');

      expect(await appliedMigrations(LIB_VERSION_SCHEMA)).toEqual(['1.0.0', '1.0.2', '1.1.0']);
    });

    it('works for the chat history package at its published version', async () => {
      await runChatHistoryPgMigrations(
        {
          databaseUrl,
          databaseSsl: false,
          direction: 'to-current-lib-version',
          schemaName: LIB_VERSION_CHAT_SCHEMA,
          libraryVersion: '1.3.5'
        },
        pool
      );

      expect(await appliedMigrations(LIB_VERSION_CHAT_SCHEMA)).toEqual(['1.0.0', '1.2.0']);
    });
  });
});
