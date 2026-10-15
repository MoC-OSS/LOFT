import { inject, injectable } from 'inversify';
import { Kysely, sql } from 'kysely';

import { Database } from '../dbTypes';
import { SESSION_DI_TYPES } from '../SessionDITypes';
import { SessionRepositoryConfig } from './config';

@injectable()
export class HealthCheckService {
  constructor(
    @inject(SESSION_DI_TYPES.SessionRepositoryDatabase)
    private readonly db: Kysely<Database>,
    @inject(SESSION_DI_TYPES.SessionRepositoryConfig)
    private config: SessionRepositoryConfig
  ) {}

  async check(): Promise<boolean> {
    try {
      // The schema name is bound as a parameter, never pasted into the SQL text
      const result = await sql<{
        schema_name: string;
      }>`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ${this.config.schema}`.execute(
        this.db
      );
      return result.rows.length > 0;
    } catch (error) {
      return false;
    }
  }
}
