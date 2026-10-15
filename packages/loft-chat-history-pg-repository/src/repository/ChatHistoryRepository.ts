import { Repository, Schema, Type, Util } from '@moc-global/loft-definitions';
import { inject, injectable } from 'inversify';
import { Kysely } from 'kysely';

import { CHAT_HISTORY_DI_TYPES } from '../ChatHistoryDITypes';
import { Database, UnifiedMessageRole } from '../dbTypes';
import { ChatHistoryConfig } from './config';
import { HealthCheckService } from './HealthCheckService';
import { MessageQueries } from './MessageQueries';

@injectable()
export class ChatHistoryRepository extends MessageQueries implements Repository.ChatHistory {
  constructor(
    @inject(CHAT_HISTORY_DI_TYPES.ChatHistoryDatabase) db: Kysely<Database>,
    @inject(CHAT_HISTORY_DI_TYPES.ChatHistoryConfig) config: ChatHistoryConfig,
    @inject(CHAT_HISTORY_DI_TYPES.ChatHistoryHealthCheckService)
    private readonly healthCheckService: HealthCheckService
  ) {
    super(db, config);
    this.checkEnums();
  }

  async addMessages(
    sessionId: Type.Entity.Session['id'],
    messagesPayload: Type.Entity.CreateMessage[]
  ): Promise<Type.Entity.ChatHistory> {
    const preparedMessages = Schema.Entity.CreateMessage.array().parse(messagesPayload);
    // Each row is stored under its own sessionId, so a mismatch would write into another session
    const foreign = preparedMessages.find((message) => message.sessionId !== sessionId);
    if (foreign) {
      throw new Error(`Cannot add a message of session ${foreign.sessionId} to session ${sessionId}`);
    }

    const appendedMessages = await this.createQuery(preparedMessages).execute();
    return appendedMessages as unknown as Type.Entity.ChatHistory;
  }

  async getMessages(sessionId: Type.Entity.Session['id']): Promise<Type.Entity.ChatHistory> {
    const messages = await this.getBySessionIdQuery(sessionId).execute();
    return messages as unknown as Type.Entity.ChatHistory;
  }

  async deleteMessages(sessionId: Type.Entity.Session['id'], messageIds: Type.Entity.Message['id'][]): Promise<void> {
    await this.db
      .withSchema(this.config.schema)
      .deleteFrom('message')
      .where('id', 'in', messageIds)
      .where('sessionId', '=', sessionId)
      .execute();
  }

  async checkHealth(): Promise<boolean> {
    return this.healthCheckService.check();
  }

  end(): Promise<void> {
    return this.db.destroy();
  }

  checkEnums(): void {
    const isEnumMessageRoleEqual = Util.areEnumsEqual(Type.LLM.UnifiedMessageRole, UnifiedMessageRole);
    if (!isEnumMessageRoleEqual) {
      throw new Error('Enums are not equal');
    }
  }
}
