import type { MigrationContext } from '@moc-global/loft-kysely-pg-migrator';
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>, { schema: SCHEMA }: MigrationContext): Promise<void> {
  await db.schema.createSchema(SCHEMA).ifNotExists().execute();

  await db
    .withSchema(SCHEMA)
    .schema.createType('unified_message_role')
    .asEnum(['system', 'user', 'assistant', 'function'])
    .execute();

  await db
    .withSchema(SCHEMA)
    .schema.createTable('message')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
    .addColumn('session_id', 'uuid', (col) => col.notNull())
    .addColumn('sequence_id', 'bigserial', (col) => col.notNull())
    .addColumn('ctx', 'jsonb', (col) => col.defaultTo(JSON.stringify({})).notNull())
    .addColumn('content', 'varchar', (col) => col.notNull())
    .addColumn('role', sql`${sql.id(SCHEMA, 'unified_message_role')}`, (col) => col.notNull())
    .addColumn('author', 'varchar(512)', (col) => col.notNull())
    .addColumn('llm_name', 'varchar(512)', (col) => col.notNull())
    .addColumn('manifest_name', 'varchar(1024)', (col) => col.notNull())
    .addColumn('is_archived', 'boolean', (col) => col.defaultTo(false).notNull())
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await db
    .withSchema(SCHEMA)
    .schema.createIndex('messages_sequence_id_index')
    .on('message')
    .column('sequence_id')
    .execute();

  await db
    .withSchema(SCHEMA)
    .schema.createIndex('messages_session_id_index')
    .on('message')
    .column('session_id')
    .execute();
}

export async function down(db: Kysely<unknown>, { schema: SCHEMA }: MigrationContext): Promise<void> {
  await db.withSchema(SCHEMA).schema.dropTable('message').execute();
  await db.withSchema(SCHEMA).schema.dropType('unified_message_role').execute();
}
