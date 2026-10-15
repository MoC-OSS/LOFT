import type { Kysely } from 'kysely';
import { Pool } from 'pg';
import { z } from 'zod';

// A PostgreSQL identifier the migrations can quote safely: lower case, at most 63 characters
export const SchemaNameSchema = z
  .string()
  .regex(/^[a-z_][a-z0-9_]{0,62}$/, 'Schema name must be lower-case letters, digits and underscores (max 63)');

// Base migration direction schema
export const MigrationDirectionSchema = z.enum(['up', 'down', 'to', 'to-latest', 'to-current-lib-version']);
export type MigrationDirection = z.infer<typeof MigrationDirectionSchema>;

// Unified Zod schemas for validation
export const ClientMigrationOptionsSchema = z.object({
  databaseUrl: z.string().url(),
  databaseSsl: z.boolean().optional().default(false),
  direction: MigrationDirectionSchema,
  migrationName: z.string().optional(),
  schemaName: SchemaNameSchema,
  migrationsFolder: z.string().optional(),
  libraryVersion: z.string().min(1)
});

export const BaseMigrationOptionsSchema = ClientMigrationOptionsSchema.extend({
  migrationsFolder: z.string().min(1),
  libraryVersion: z.string().min(1)
});

// Client-facing migration options (for external API calls)
export type ClientMigrationOptions = z.infer<typeof ClientMigrationOptionsSchema>;

// Base migration options type (for internal migrator use)
export type BaseMigrationOptions = z.infer<typeof BaseMigrationOptionsSchema> & {
  /** Optional existing pool to use instead of creating a new one */
  pool?: Pool;
};

// Base config interface for database connection
export interface BaseMigrationConfig {
  DATABASE_URL: string;
  DATABASE_SSL: boolean;
  SCHEMA_NAME: string;
}

/** What BaseMigrator passes to every migration besides the database */
export interface MigrationContext {
  /** Schema the package's tables live in, from the `schemaName` option */
  schema: string;
}

/** A migration file's exports. Kysely calls `up(db)`; BaseMigrator adds the context. */
export interface SchemaMigration {
  up(db: Kysely<unknown>, context: MigrationContext): Promise<void>;
  down?(db: Kysely<unknown>, context: MigrationContext): Promise<void>;
}

// CLI command args schema
export const MigrationCommandArgsSchema = z.object({
  direction: MigrationDirectionSchema,
  migrationName: z.string().optional(),
  env: z.string()
});
