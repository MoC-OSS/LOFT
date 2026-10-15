import { promises as fs } from 'fs';
import { FileMigrationProvider, Kysely, Migration, MigrationProvider, Migrator, PostgresDialect } from 'kysely';
import * as path from 'path';
import { Pool } from 'pg';

import type {
  BaseMigrationConfig,
  BaseMigrationOptions,
  MigrationContext,
  MigrationDirection,
  SchemaMigration
} from './types';
import { BaseMigrationOptionsSchema } from './types';
import { resolveMigrationForVersion } from './versions';

/**
 * Loads the migration files and passes each one the migration context, so a migration
 * works on the schema it was asked for instead of reading it from the environment.
 */
class ContextMigrationProvider implements MigrationProvider {
  constructor(
    private readonly files: MigrationProvider,
    private readonly context: MigrationContext
  ) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const migrations = await this.files.getMigrations();
    return Object.fromEntries(
      Object.entries(migrations).map(([name, migration]) => {
        // Migration files declare up(db, context); Kysely's type only knows up(db)
        const file = migration as unknown as SchemaMigration;
        const down = file.down;
        return [
          name,
          {
            up: (db: Kysely<unknown>) => file.up(db, this.context),
            down: down ? (db: Kysely<unknown>) => down(db, this.context) : undefined
          }
        ];
      })
    );
  }
}

/**
 * Base Kysely PostgreSQL migrator class that encapsulates all migration logic
 * to avoid global state issues in concurrent environments
 */
export class BaseMigrator {
  protected cfg: BaseMigrationConfig;
  protected db!: Kysely<any>; // Definite assignment assertion
  protected pool: Pool; // The pool being used
  protected isSharedPool: boolean; // Track if pool is shared

  constructor(
    protected options: BaseMigrationOptions,
    pool?: Pool
  ) {
    // Validate config using Zod schema
    const validatedConfig = BaseMigrationOptionsSchema.parse(options);
    this.cfg = this.createConfig(validatedConfig);

    // Use provided pool or create new one
    if (pool) {
      this.pool = pool;
      this.isSharedPool = true;
    } else {
      this.pool = new Pool({
        connectionString: this.cfg.DATABASE_URL as string,
        ssl: this.cfg.DATABASE_SSL as boolean
      });
      this.isSharedPool = false;
    }

    this.initDB();
  }

  /**
   * Create configuration from migration options
   * Now uses unified BaseMigrationConfig
   */
  protected createConfig(options: BaseMigrationOptions): BaseMigrationConfig {
    return {
      DATABASE_URL: options.databaseUrl,
      DATABASE_SSL: options.databaseSsl ?? false,
      SCHEMA_NAME: options.schemaName
    };
  }

  /**
   * Initialize Kysely database connection
   */
  private initDB() {
    this.db = new Kysely({
      dialect: new PostgresDialect({ pool: this.pool })
    });
  }

  /**
   * Clean up database connection
   * Only destroys if using own pool, not shared pool
   */
  async destroy() {
    if (!this.isSharedPool) {
      await this.db.destroy();
    }
  }

  /**
   * Check if the required schema exists in the database
   */
  private async checkSchemaExist() {
    const schemaName = this.cfg.SCHEMA_NAME;
    const result = await this.db
      .selectFrom('information_schema.schemata')
      .select('schema_name')
      .where('schema_name', '=', schemaName)
      .execute();

    // Thrown, not process.exit: runMigrations is also called from applications. The CLI exits with code 1.
    if (result.length === 0) {
      throw new Error(`Schema "${schemaName}" does not exist in the database. Create it first.`);
    }
    console.log(`SCHEMA_NAME: ${schemaName} is exist in database`);
  }

  /**
   * Get available migration filenames
   */
  protected async getMigrationFilenames(): Promise<string[]> {
    const files = await fs.readdir(this.options.migrationsFolder);
    // Filter migration files (.js, .mjs) and remove duplicates
    const migrationFiles = files
      .filter((file) => /\.(js|mjs)$/.test(file) && !file.endsWith('.d.ts'))
      .map((file) => path.parse(file).name);

    // Remove duplicates (same migration in different formats)
    return [...new Set(migrationFiles)];
  }

  /**
   * Execute migrations based on direction
   */
  async migrate(direction: MigrationDirection, migrationName?: string) {
    await this.checkSchemaExist();
    const provider = new ContextMigrationProvider(
      new FileMigrationProvider({ fs, path, migrationFolder: this.options.migrationsFolder }),
      { schema: this.cfg.SCHEMA_NAME }
    );
    const migrator = new Migrator({ db: this.db, migrationTableSchema: this.cfg.SCHEMA_NAME, provider });

    try {
      let error, results;
      switch (direction) {
        case 'to-latest':
          ({ error, results } = await migrator.migrateToLatest());
          break;

        case 'up':
          ({ error, results } = await migrator.migrateUp());
          break;

        case 'down':
          ({ error, results } = await migrator.migrateDown());
          break;

        case 'to': {
          if (!migrationName) throw new Error('Migration name is required for "to" direction.');
          // Validate migration exists (CLI also validates via choices)
          const existMigrationNames = await this.getMigrationFilenames();
          if (!existMigrationNames.includes(migrationName)) {
            throw new Error(
              `Migration "${migrationName}" does not exist in migrations directory. Available: ${existMigrationNames.join(', ')}`
            );
          }
          ({ error, results } = await migrator.migrateTo(migrationName));
          break;
        }

        case 'to-current-lib-version': {
          const migrationNames = Object.keys(await provider.getMigrations());
          const target = resolveMigrationForVersion(migrationNames, this.options.libraryVersion);
          console.log(`library version ${this.options.libraryVersion} -> migration "${target}"`);
          ({ error, results } = await migrator.migrateTo(target));
          break;
        }

        default:
          throw new Error(`Invalid migration direction: ${direction}`);
      }

      results?.forEach((it) => {
        if (it.status === 'Success') console.log(`migration "${it.migrationName}" was executed successfully`);
        else if (it.status === 'Error') console.error(`failed to execute migration "${it.migrationName}"`);
      });

      if (error) throw error;

      console.log('Migration completed successfully.');
    } catch (error) {
      console.error('failed to migrate');
      console.error(error);
      throw error;
    }
  }
}
