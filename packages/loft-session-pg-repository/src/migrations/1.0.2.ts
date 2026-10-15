import type { MigrationContext } from '@moc-global/loft-kysely-pg-migrator';
import { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>, { schema: SCHEMA }: MigrationContext): Promise<void> {
  // Add external_key column to session table
  await db.withSchema(SCHEMA).schema.alterTable('session').addColumn('external_key', 'varchar(1024)').execute();

  // Create a unique index on external_key
  await db
    .withSchema(SCHEMA)
    .schema.createIndex('session_external_key_idx')
    .on('session')
    .column('external_key')
    .unique()
    .execute();
}

export async function down(db: Kysely<unknown>, { schema: SCHEMA }: MigrationContext): Promise<void> {
  // Drop the index first
  await db.withSchema(SCHEMA).schema.dropIndex('session_external_key_idx').execute();

  // Then drop the column
  await db.withSchema(SCHEMA).schema.alterTable('session').dropColumn('external_key').execute();
}
