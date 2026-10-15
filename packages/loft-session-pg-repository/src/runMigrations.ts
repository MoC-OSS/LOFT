import * as path from 'node:path';

import { BaseMigrator } from '@moc-global/loft-kysely-pg-migrator';
import { Pool } from 'pg';

/**
 * Options of `runSessionPgMigrations`. Declared here rather than taken from the migrator, which is not
 * published, so the type resolves for users. The migrator validates the values.
 */
export interface SessionMigrationOptions {
  databaseUrl: string;
  /** Default: false */
  databaseSsl?: boolean;
  direction: 'up' | 'down' | 'to' | 'to-latest' | 'to-current-lib-version';
  /** Required for the `to` direction */
  migrationName?: string;
  /** An existing schema; lower-case letters, digits and underscores */
  schemaName: string;
  /** Default: the migrations shipped with this package */
  migrationsFolder?: string;
  /** Used by `to-current-lib-version` */
  libraryVersion: string;
}

// src/runMigrations.ts -> src/migrations (TypeScript, in tests); lib/index.(m)js -> lib/migrations (built).
// The ES module build gets __dirname from tsup's shims.
const MIGRATIONS_FOLDER = path.resolve(__dirname, 'migrations');

/**
 * Runs the session migrations from code. The CLI is `loft-session-pg-migrate`.
 */
export async function runMigrations(options: SessionMigrationOptions, pool?: Pool): Promise<void> {
  const migrator = new BaseMigrator(
    {
      ...options,
      databaseSsl: options.databaseSsl ?? false,
      migrationsFolder: options.migrationsFolder || MIGRATIONS_FOLDER
    },
    pool
  );
  try {
    await migrator.migrate(options.direction, options.migrationName);
  } finally {
    await migrator.destroy();
  }
}
