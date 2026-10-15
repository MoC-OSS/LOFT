import type { MigrationContext } from '@moc-global/loft-kysely-pg-migrator';
import { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>, { schema: SCHEMA }: MigrationContext): Promise<void> {
  await db
    .withSchema(SCHEMA)
    .schema.createTable('focus_state')
    .addColumn('session_id', 'uuid', (col) => col.notNull().references(`${SCHEMA}.session.id`).onDelete('cascade'))
    .addColumn('agent_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('field_key', 'varchar(255)', (col) => col.notNull())
    .addColumn('value', 'jsonb', (col) => col.notNull())
    .addPrimaryKeyConstraint('focus_state_pkey', ['session_id', 'agent_name', 'field_key'])
    .execute();

  await db
    .withSchema(SCHEMA)
    .schema.createIndex('focus_state_session_agent_idx')
    .on('focus_state')
    .columns(['session_id', 'agent_name'])
    .execute();
}

export async function down(db: Kysely<unknown>, { schema: SCHEMA }: MigrationContext): Promise<void> {
  await db.withSchema(SCHEMA).schema.dropIndex('focus_state_session_agent_idx').execute();
  await db.withSchema(SCHEMA).schema.dropTable('focus_state').execute();
}
