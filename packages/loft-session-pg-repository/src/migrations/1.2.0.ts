import type { MigrationContext } from '@moc-global/loft-kysely-pg-migrator';
import { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>, { schema: SCHEMA }: MigrationContext): Promise<void> {
  await db.withSchema(SCHEMA).schema.alterTable('session').addColumn('focus_agent', 'varchar(256)').execute();
}

export async function down(db: Kysely<unknown>, { schema: SCHEMA }: MigrationContext): Promise<void> {
  await db.withSchema(SCHEMA).schema.alterTable('session').dropColumn('focus_agent').execute();
}
