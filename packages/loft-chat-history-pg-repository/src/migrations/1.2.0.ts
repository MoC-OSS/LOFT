import type { MigrationContext } from '@moc-global/loft-kysely-pg-migrator';
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>, { schema: SCHEMA }: MigrationContext): Promise<void> {
  // Add 'tool' to the unified_message_role enum
  await sql`ALTER TYPE ${sql.id(SCHEMA, 'unified_message_role')} ADD VALUE IF NOT EXISTS 'tool'`.execute(db);

  // Alter the 'content' column to change its type from varchar to jsonb
  // with proper conversion of text content to the required JSON structure
  await sql`
    ALTER TABLE ${sql.id(SCHEMA, 'message')}
    ALTER COLUMN content TYPE jsonb 
    USING jsonb_build_array(
      jsonb_build_object(
        'type', 'text',
        'text', content
      )
    )
  `.execute(db);

  // Set default value for content column
  await sql`
    ALTER TABLE ${sql.id(SCHEMA, 'message')}
    ALTER COLUMN content SET DEFAULT '[]'::jsonb
  `.execute(db);

  // Rename is_archived column to llm_ignore
  await sql`
    ALTER TABLE ${sql.id(SCHEMA, 'message')}
    RENAME COLUMN is_archived TO llm_ignore
  `.execute(db);
}

export async function down(db: Kysely<unknown>, { schema: SCHEMA }: MigrationContext): Promise<void> {
  // Rename llm_ignore column back to is_archived
  await sql`
    ALTER TABLE ${sql.id(SCHEMA, 'message')}
    RENAME COLUMN llm_ignore TO is_archived
  `.execute(db);

  // Remove default value for content column
  await sql`
    ALTER TABLE ${sql.id(SCHEMA, 'message')}
    ALTER COLUMN content DROP DEFAULT
  `.execute(db);

  // Extract the text field from the first object with type='text'
  await sql`
    ALTER TABLE ${sql.id(SCHEMA, 'message')} 
    ALTER COLUMN content TYPE varchar 
    USING (
      SELECT jsonb_path_query_first(content, '$[*] ? (@.type == "text")."text"')::text
    )
  `.execute(db);
}
