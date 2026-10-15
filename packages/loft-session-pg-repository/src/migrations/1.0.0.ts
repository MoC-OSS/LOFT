import type { MigrationContext } from '@moc-global/loft-kysely-pg-migrator';
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>, { schema: SCHEMA }: MigrationContext): Promise<void> {
  await db.schema.createSchema(SCHEMA).ifNotExists().execute();

  await db
    .withSchema(SCHEMA)
    .schema.createTable('session')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
    .addColumn('ctx', 'jsonb', (col) => col.defaultTo(JSON.stringify({})).notNull())
    .addColumn('current_llm_name', 'varchar(512)', (col) => col.notNull())
    .addColumn('current_manifest_name', 'varchar(1024)', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();
}

export async function down(db: Kysely<unknown>, { schema: SCHEMA }: MigrationContext): Promise<void> {
  await db.withSchema(SCHEMA).schema.dropTable('session').execute();
}
