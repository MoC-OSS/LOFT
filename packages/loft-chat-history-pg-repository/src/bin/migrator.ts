#!/usr/bin/env node

import { createCLI, getPackageVersion } from '@moc-global/loft-kysely-pg-migrator/cli';
import * as path from 'path';
import { z } from 'zod';

// Chat history specific env schema
const ChatHistoryEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_SSL: z.preprocess((val) => val === 'true' || val === true, z.boolean().default(false)),
  DATABASE_CHAT_HISTORY_SCHEMA_NAME: z.string()
});

// lib/bin -> lib/migrations (built) and src/bin -> src/migrations (source)
const CLI_MIGRATIONS_FOLDER = path.resolve(__dirname, '../migrations');

/**
 * CLI main function using shared migrator
 */
function main(): Promise<void> {
  const cli = createCLI({
    scriptName: 'loft-chat-history-pg-migrate',
    envSchema: ChatHistoryEnvSchema,
    envFieldMapping: {
      databaseUrl: 'DATABASE_URL',
      databaseSsl: 'DATABASE_SSL',
      schemaName: 'DATABASE_CHAT_HISTORY_SCHEMA_NAME'
    },
    libraryVersion: getPackageVersion(path.resolve(__dirname, '../..')),
    migrationsFolder: CLI_MIGRATIONS_FOLDER
  });
  return cli();
}

// Execute CLI only if run directly (not when imported as module)
if (typeof require !== 'undefined' && require.main === module) {
  // CommonJS environment - run CLI
  main().catch((error) => {
    console.error('Migration CLI failed:', error);
    process.exitCode = 1;
  });
}
// Note: ESM detection removed due to TypeScript compilation issues in CommonJS target
