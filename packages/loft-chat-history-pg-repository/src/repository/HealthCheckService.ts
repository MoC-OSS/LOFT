import { inject, injectable } from 'inversify';
import { Kysely, sql } from 'kysely';

import { CHAT_HISTORY_DI_TYPES } from '../ChatHistoryDITypes';
import { Database } from '../dbTypes';
import { ChatHistoryConfig } from './config';

@injectable()
export class HealthCheckService {
  constructor(
    @inject(CHAT_HISTORY_DI_TYPES.ChatHistoryDatabase)
    private readonly db: Kysely<Database>,
    @inject(CHAT_HISTORY_DI_TYPES.ChatHistoryConfig)
    private config: ChatHistoryConfig
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
