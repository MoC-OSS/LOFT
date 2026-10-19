import { injectable } from 'inversify';
import {
  DeleteQueryBuilder,
  DeleteResult,
  InsertQueryBuilder,
  Kysely,
  SelectQueryBuilder,
  sql,
  UpdateQueryBuilder
} from 'kysely';

import { Database } from '../dbTypes';
import { Message, MessageUpdate, NewMessage } from '../dbTypes/Message';
import { ChatHistoryConfig } from './config';

@injectable()
export abstract class MessageQueries {
  constructor(
    protected readonly db: Kysely<Database>,
    protected readonly config: ChatHistoryConfig
  ) {}

  createQuery(messages: NewMessage[]): InsertQueryBuilder<Database, 'message', Message> {
    const processedMessages = messages.map((msg: NewMessage) => {
      // Convert content to SQL expression with JSONB cast for proper PostgreSQL handling
      if (msg.content) {
        const contentStr = JSON.stringify(msg.content);
        return {
          ...msg,
          content: sql`${contentStr}::jsonb` as any
        };
      }
      return msg;
    });

    // Use the insertInto method with processed messages
    const query = this.db.withSchema(this.config.schema).insertInto('message').values(processedMessages).returningAll();

    return query;
  }

  getBySessionIdQuery(sessionId: Message['sessionId']): SelectQueryBuilder<Database, 'message', Message> {
    return this.db
      .withSchema(this.config.schema)
      .selectFrom('message')
      .selectAll()
      .where('message.sessionId', '=', sessionId)
      .orderBy('message.sequenceId', 'asc');
  }

  /** The latest `limit` messages of a session, newest first */
  getLatestBySessionIdQuery(
    sessionId: Message['sessionId'],
    limit: number
  ): SelectQueryBuilder<Database, 'message', Message> {
    return this.db
      .withSchema(this.config.schema)
      .selectFrom('message')
      .selectAll()
      .where('message.sessionId', '=', sessionId)
      .orderBy('message.sequenceId', 'desc')
      .limit(limit);
  }

  getByIdQuery(
    sessionId: Message['sessionId'],
    messageId: Message['id']
  ): SelectQueryBuilder<Database, 'message', Message> {
    return this.db
      .withSchema(this.config.schema)
      .selectFrom('message')
      .selectAll()
      .where('id', '=', messageId)
      .where('message.sessionId', '=', sessionId);
  }

  updateByIdsQuery(
    sessionId: Message['sessionId'],
    messageIds: Message['id'][],
    message: MessageUpdate
  ): UpdateQueryBuilder<Database, 'message', 'message', Message> {
    return this.db
      .withSchema(this.config.schema)
      .updateTable('message')
      .set(message)
      .where('id', 'in', messageIds)
      .where('message.sessionId', '=', sessionId)
      .returningAll();
  }

  deleteByIdQuery(
    sessionId: Message['sessionId'],
    messageId: Message['id']
  ): DeleteQueryBuilder<Database, 'message', DeleteResult> {
    return this.db
      .withSchema(this.config.schema)
      .deleteFrom('message')
      .where('id', '=', messageId)
      .where('message.sessionId', '=', sessionId);
  }
}
