import type { PGLiteInstance } from '@moc-global/loft-pglite';
import { PGLiteInstanceFactory, PGLiteUtils } from '@moc-global/loft-pglite';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as v100 from '../../migrations/1.0.0';
import * as v120 from '../../migrations/1.2.0';

const SCHEMA = 'loft_chat_history_migration_test';
const SESSION_ID = '11111111-1111-4111-8111-111111111111';

let pgliteInstance: PGLiteInstance;
let pool: Pool;
let db: Kysely<unknown>;
const context = { schema: SCHEMA };

async function contents(): Promise<unknown[]> {
  const { rows } = await pool.query<{ content: unknown }>(`SELECT content FROM ${SCHEMA}.message ORDER BY sequence_id`);
  return rows.map((row) => row.content);
}

beforeAll(async () => {
  pgliteInstance = await PGLiteInstanceFactory.create();
  pool = PGLiteUtils.createPool(pgliteInstance);
  await PGLiteUtils.createSchemas(pool, [SCHEMA]);
  await PGLiteUtils.createExtensions(pool);
  db = new Kysely({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db?.destroy();
  await pgliteInstance?.close();
});

describe('chat history migration 1.2.0', () => {
  it('rolls back to a varchar content with the first text part', async () => {
    // The migration files are called directly: Kysely's FileMigrationProvider imports them natively, without Vitest
    await v100.up(db, context);
    await v120.up(db, context);
    const parts = [
      [{ type: 'text', text: 'Hello' }],
      [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' }
      ],
      [{ type: 'tool_call', id: 'call-1', name: 'lookup', arguments: {} }]
    ];
    for (const content of parts) {
      await pool.query(
        `INSERT INTO ${SCHEMA}.message (session_id, content, role, author, llm_name, manifest_name)
         VALUES ($1, $2, 'assistant', 'assistant', 'test-llm', 'test-manifest')`,
        [SESSION_ID, JSON.stringify(content)]
      );
    }

    await v120.down(db, context);

    // A message without text keeps an empty string, as content is NOT NULL
    expect(await contents()).toEqual(['Hello', 'first', '']);
    const { rows } = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'message'",
      [SCHEMA]
    );
    expect(rows.map((row) => row.column_name)).toContain('is_archived');
  });

  it('migrates up again', async () => {
    await v120.up(db, context);

    expect(await contents()).toEqual([
      [{ type: 'text', text: 'Hello' }],
      [{ type: 'text', text: 'first' }],
      [{ type: 'text', text: '' }]
    ]);
  });
});
