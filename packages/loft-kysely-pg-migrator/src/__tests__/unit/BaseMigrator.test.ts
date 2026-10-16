import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PGLiteInstance } from '@moc-global/loft-pglite';
import { PGLiteInstanceFactory, PGLiteUtils } from '@moc-global/loft-pglite';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BaseMigrator } from '../../BaseMigrator';

const SCHEMA = 'migrator_test';

// Each migration creates a table in the schema it receives in the migration context
const migrationFile = (table: string) => `
exports.up = (db, { schema }) => db.schema.withSchema(schema).createTable('${table}').addColumn('id', 'integer').execute();
exports.down = (db, { schema }) => db.schema.withSchema(schema).dropTable('${table}').execute();
`;

describe('BaseMigrator', () => {
  let pglite: PGLiteInstance;
  let pool: Pool;
  let migrationsFolder: string;

  beforeAll(async () => {
    pglite = await PGLiteInstanceFactory.create();
    pool = PGLiteUtils.createPool(pglite);
    await PGLiteUtils.createSchemas(pool, [SCHEMA]);

    migrationsFolder = await mkdtemp(join(tmpdir(), 'loft-migrations-'));
    await writeFile(join(migrationsFolder, '1.0.0.js'), migrationFile('first'));
    await writeFile(join(migrationsFolder, '1.1.0.js'), migrationFile('second'));
  });

  afterAll(async () => {
    await pool?.end();
    await pglite?.close();
    if (migrationsFolder) await rm(migrationsFolder, { recursive: true, force: true });
  });

  const tables = async () => {
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name NOT LIKE 'kysely_%' ORDER BY 1`,
      [SCHEMA]
    );
    return result.rows.map((row) => row.table_name);
  };

  const migrate = (direction: 'to-latest' | 'down') =>
    new BaseMigrator(
      {
        databaseUrl: pglite.connectionString,
        databaseSsl: false,
        direction,
        schemaName: SCHEMA,
        migrationsFolder,
        libraryVersion: '1.1.0'
      },
      pool
    ).migrate(direction);

  it('runs the migration files in the schema it is given, and rolls back the last one', async () => {
    await migrate('to-latest');
    expect(await tables()).toEqual(['first', 'second']);

    await migrate('down');
    expect(await tables()).toEqual(['first']);
  });
});
