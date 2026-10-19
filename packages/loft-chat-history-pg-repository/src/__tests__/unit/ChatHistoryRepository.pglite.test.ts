import 'reflect-metadata';

import { Interface, Logger, Repository, Type } from '@moc-global/loft-definitions';
import type { PGLiteInstance } from '@moc-global/loft-pglite';
import { PGLiteInstanceFactory, PGLiteUtils } from '@moc-global/loft-pglite';
import { testChatHistoryRepository } from '@moc-global/loft-test-suite';
import { Container } from 'inversify';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ChatHistoryRepositoryConstructor } from '../../ChatHistoryConstructor';
import * as v100 from '../../migrations/1.0.0';
import * as v120 from '../../migrations/1.2.0';
import { ChatHistoryRepository } from '../../repository';

// The migration files in order. They are called directly: Kysely's FileMigrationProvider imports them natively,
// without Vitest, which cannot load TypeScript
const MIGRATIONS = [v100, v120];
const SCHEMA = 'loft_chat_history_contract';
const MIGRATION_SCHEMA = 'loft_chat_history_migrations';

let pgliteInstance: PGLiteInstance;
let pool: Pool;
let migrationDb: Kysely<unknown>;
let repository: Repository.ChatHistory;

async function tablesIn(schema: string): Promise<string[]> {
  const { rows } = await pool.query<{ table_name: string }>(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
    [schema]
  );
  return rows.map((row) => row.table_name);
}

beforeAll(async () => {
  Logger.configure({ logLevel: Interface.LogLevel.NONE });
  pgliteInstance = await PGLiteInstanceFactory.create();
  pool = PGLiteUtils.createPool(pgliteInstance);
  await PGLiteUtils.createSchemas(pool, [SCHEMA, MIGRATION_SCHEMA]);
  await PGLiteUtils.createExtensions(pool);
  // Not destroyed: that would end the shared pool, which afterAll ends once
  migrationDb = new Kysely({ dialect: new PostgresDialect({ pool }) });
  for (const migration of MIGRATIONS) await migration.up(migrationDb, { schema: SCHEMA });

  const constructor = new ChatHistoryRepositoryConstructor(new PostgresDialect({ pool }), { schema: SCHEMA });
  constructor.initializeContainer(new Container());
  repository = constructor.getInstance();
});

afterAll(async () => {
  await repository?.end();
  await pgliteInstance?.close();
});

describe('ChatHistoryRepository on PostgreSQL (PGlite)', () => {
  testChatHistoryRepository(() => repository);

  it('deletes only the given messages of the session', async () => {
    const sessionId = '33333333-3333-4333-8333-333333333333';
    const stored = await repository.addMessages(
      sessionId,
      ['keep', 'delete'].map((text) => ({
        sessionId,
        ctx: {},
        content: [{ type: 'text' as const, text }],
        role: Type.LLM.UnifiedMessageRole.user,
        author: 'user',
        llmName: 'test-llm',
        manifestName: 'test-manifest',
        llmIgnore: false
      }))
    );

    await (repository as ChatHistoryRepository).deleteMessages(sessionId, [stored[1].id]);

    expect((await repository.getMessages(sessionId)).map((message) => message.id)).toEqual([stored[0].id]);
  });
});

describe('chat history migrations', () => {
  it('create the message table in the schema they are given', async () => {
    for (const migration of MIGRATIONS) await migration.up(migrationDb, { schema: MIGRATION_SCHEMA });

    expect(await tablesIn(MIGRATION_SCHEMA)).toEqual(['message']);
  });
});
