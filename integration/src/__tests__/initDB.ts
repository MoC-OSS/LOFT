import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { runChatHistoryPgMigrations } from '@moc-global/loft-chat-history-pg-repository';
import { PGLiteInstanceFactory, PGLiteUtils } from '@moc-global/loft-pglite';
import { runSessionPgMigrations } from '@moc-global/loft-session-pg-repository';
import { Pool } from 'pg';

import { env } from './config';

function packageVersion(dir: string): string {
  const packagePath = path.resolve(__dirname, '../../../packages', dir, 'package.json');
  return JSON.parse(fs.readFileSync(packagePath, 'utf-8')).version;
}

export interface TestDatabaseInstance {
  pool: Pool;
  sessionSchema: string;
  chatHistorySchema: string;
  truncateAll: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * A migrated database for one test file: an in-process PGlite by default, or, when LOFT_TEST_DATABASE_URL is set, a
 * database of its own on that PostgreSQL server, dropped again by close().
 */
export async function initDB(): Promise<TestDatabaseInstance> {
  return env.LOFT_TEST_DATABASE_URL ? initServerDB(env.LOFT_TEST_DATABASE_URL) : initPGLiteDB();
}

async function initPGLiteDB(): Promise<TestDatabaseInstance> {
  const pgliteInstance = await PGLiteInstanceFactory.create();
  const pool = PGLiteUtils.createPool(pgliteInstance);
  const sessionSchema = env.LOFT_SESSION_DATABASE_SCHEMA_NAME;
  const chatHistorySchema = env.LOFT_CHAT_HISTORY_DATABASE_SCHEMA_NAME;

  await PGLiteUtils.createSchemas(pool, [sessionSchema, chatHistorySchema]);
  await PGLiteUtils.createExtensions(pool);
  await migrate(pool, pgliteInstance.connectionString, sessionSchema, chatHistorySchema);

  return {
    pool,
    sessionSchema,
    chatHistorySchema,
    truncateAll: () => truncate(pool, sessionSchema, chatHistorySchema),
    close: async () => {
      await pool.end();
      await pgliteInstance.close();
    }
  };
}

async function initServerDB(serverUrl: string): Promise<TestDatabaseInstance> {
  // Test files run in parallel against the same server, so each gets a database of its own. Separate schemas are not
  // enough: the migrator reads the catalog of the whole database, and fails while another file drops its schemas.
  const database = `loft_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new Pool({ connectionString: serverUrl, max: 1 });
  await admin.query(`CREATE DATABASE ${database}`);

  const databaseUrl = new URL(serverUrl);
  databaseUrl.pathname = `/${database}`;
  const pool = new Pool({ connectionString: databaseUrl.toString() });
  const sessionSchema = env.LOFT_SESSION_DATABASE_SCHEMA_NAME;
  const chatHistorySchema = env.LOFT_CHAT_HISTORY_DATABASE_SCHEMA_NAME;

  await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await pool.query(`CREATE SCHEMA ${sessionSchema}`);
  await pool.query(`CREATE SCHEMA ${chatHistorySchema}`);
  await migrate(pool, databaseUrl.toString(), sessionSchema, chatHistorySchema);

  return {
    pool,
    sessionSchema,
    chatHistorySchema,
    truncateAll: () => truncate(pool, sessionSchema, chatHistorySchema),
    close: async () => {
      // FORCE ends connections that are still closing; their errors are expected here
      pool.on('error', () => undefined);
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.end();
    }
  };
}

async function migrate(pool: Pool, databaseUrl: string, sessionSchema: string, chatHistorySchema: string) {
  await runSessionPgMigrations(
    {
      databaseUrl,
      direction: 'to-latest',
      schemaName: sessionSchema,
      libraryVersion: packageVersion('loft-session-pg-repository')
    },
    pool
  );
  await runChatHistoryPgMigrations(
    {
      databaseUrl,
      direction: 'to-latest',
      schemaName: chatHistorySchema,
      libraryVersion: packageVersion('loft-chat-history-pg-repository')
    },
    pool
  );
}

async function truncate(pool: Pool, sessionSchema: string, chatHistorySchema: string) {
  await pool.query(`TRUNCATE TABLE ${sessionSchema}.session, ${chatHistorySchema}.message CASCADE`);
}
