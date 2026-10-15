import * as path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { z } from 'zod';

import { BaseMigrator } from './BaseMigrator';
import type { BaseMigrationOptions } from './types';
import { MigrationCommandArgsSchema, MigrationDirectionSchema } from './types';
import { initEnvConfig } from './utils';

export interface CLIConfig<TEnv = any> {
  scriptName: string;
  envSchema: z.ZodSchema<TEnv>;
  envFieldMapping: {
    databaseUrl: keyof TEnv;
    databaseSsl: keyof TEnv;
    schemaName: keyof TEnv;
  };
  libraryVersion: string;
  migrationsFolder: string;
}

/**
 * Get available migration filenames for CLI choices
 */
async function getMigrationFilenames(migrationsFolder: string): Promise<string[]> {
  const { promises: fs } = await import('fs');
  const files = await fs.readdir(migrationsFolder);
  // Filter only .js files and return names without extension
  const filenames = files.filter((file) => file.endsWith('.js')).map((file) => path.parse(file).name);
  return filenames;
}

/**
 * Create CLI for a specific migrator type
 */
export function createCLI<TEnv>(config: CLIConfig<TEnv>) {
  return async function main() {
    const migrationFileNames = await getMigrationFilenames(config.migrationsFolder);
    const migrationDirections = MigrationDirectionSchema.options;

    await yargs(hideBin(process.argv))
      .scriptName(config.scriptName)
      .command(
        '* <direction> [migration-name]',
        '',
        (yargs) => {
          yargs
            .positional('direction', {
              describe: 'Migration direction',
              demandOption: true,
              choices: migrationDirections
            })
            .positional('migration-name', {
              describe: 'Migration file name, need only for direction "to"',
              choices: migrationFileNames
            });
        },
        async (argv) => {
          const argsValidation = MigrationCommandArgsSchema.safeParse(argv);
          if (argsValidation.success === false) {
            console.error('Invalid command arguments:', argsValidation.error.issues);
            process.exit(1);
          }
          const { direction, migrationName, env: envPath } = argsValidation.data;

          // Initialize environment configuration with the provided env path
          const env = initEnvConfig(config.envSchema, envPath);

          // Extract database configuration using the field mapping
          const databaseUrl = String(env[config.envFieldMapping.databaseUrl]);
          const databaseSsl = Boolean(env[config.envFieldMapping.databaseSsl]);
          const schemaName = String(env[config.envFieldMapping.schemaName]);

          // Create migration options using the extracted env values
          const options: BaseMigrationOptions = {
            databaseUrl,
            databaseSsl,
            direction,
            migrationName,
            schemaName,
            libraryVersion: config.libraryVersion,
            migrationsFolder: config.migrationsFolder
          };

          // Always use BaseMigrator
          const migrator = new BaseMigrator(options);
          try {
            await migrator.migrate(direction, migrationName);
          } catch (error) {
            console.error('Migration failed:', error);
            process.exit(1);
          } finally {
            await migrator.destroy();
          }
        }
      )
      .option('help', {
        alias: 'h',
        type: 'boolean',
        description: 'Show help'
      })
      .option('env', {
        alias: 'e',
        type: 'string',
        description: 'Path to the .env file',
        default: '.env.loft-pg-migrations'
      })
      .demandCommand(1, 'You need at least one command before moving on')
      .recommendCommands()
      .parserConfiguration({ 'dot-notation': false })
      .strict()
      .parseAsync();
  };
}
