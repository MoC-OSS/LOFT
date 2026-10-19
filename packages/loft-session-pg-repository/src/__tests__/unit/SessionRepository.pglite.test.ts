import 'reflect-metadata';

import { Interface, Logger, Repository } from '@moc-global/loft-definitions';
import type { PGLiteInstance } from '@moc-global/loft-pglite';
import { PGLiteInstanceFactory, PGLiteUtils } from '@moc-global/loft-pglite';
import { testSessionRepository } from '@moc-global/loft-test-suite';
import { Container } from 'inversify';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as v100 from '../../migrations/1.0.0';
import * as v102 from '../../migrations/1.0.2';
import * as v110 from '../../migrations/1.1.0';
import * as v120 from '../../migrations/1.2.0';
import { SessionRepositoryConstructor } from '../../SessionRepositoryConstructor';

// The migration files in order. They are called directly: Kysely's FileMigrationProvider imports them natively,
// without Vitest, which cannot load TypeScript
const MIGRATIONS = [v100, v102, v110, v120];
const SCHEMA = 'loft_session_contract';
const MIGRATION_SCHEMA = 'loft_session_migrations';

let pgliteInstance: PGLiteInstance;
let pool: Pool;
let migrationDb: Kysely<unknown>;
let repository: Repository.Session;

async function tablesIn(schema: string): Promise<string[]> {
  const { rows } = await pool.query<{ table_name: string }>(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
    [schema]
  );
  return rows.map((row) => row.table_name);
}

beforeAll(async () => {
  // The contract suite provokes errors on purpose, and the repository logs each one
  Logger.configure({ logLevel: Interface.LogLevel.NONE });
  pgliteInstance = await PGLiteInstanceFactory.create();
  pool = PGLiteUtils.createPool(pgliteInstance);
  await PGLiteUtils.createSchemas(pool, [SCHEMA, MIGRATION_SCHEMA]);
  await PGLiteUtils.createExtensions(pool);
  // Not destroyed: that would end the shared pool, which afterAll ends once
  migrationDb = new Kysely({ dialect: new PostgresDialect({ pool }) });
  for (const migration of MIGRATIONS) await migration.up(migrationDb, { schema: SCHEMA });

  const constructor = new SessionRepositoryConstructor(new PostgresDialect({ pool }), { schema: SCHEMA });
  constructor.initializeContainer(new Container());
  repository = constructor.getInstance();
});

afterAll(async () => {
  await repository?.end();
  await pgliteInstance?.close();
});

describe('SessionRepository on PostgreSQL (PGlite)', () => {
  testSessionRepository(() => repository);
});

describe('session migrations', () => {
  it('run up and back down in the schema they are given', async () => {
    for (const migration of MIGRATIONS) await migration.up(migrationDb, { schema: MIGRATION_SCHEMA });
    expect(await tablesIn(MIGRATION_SCHEMA)).toEqual(['focus_state', 'session']);

    for (const migration of [...MIGRATIONS].reverse()) await migration.down(migrationDb, { schema: MIGRATION_SCHEMA });

    expect(await tablesIn(MIGRATION_SCHEMA)).toEqual([]);
  });
});
