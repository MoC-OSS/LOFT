import { Chat, Type } from '../../..';
import { ChatError } from './ChatError';

export class ShutdownError extends ChatError {
  operationId: string;
  constructor(
    operationId: string,
    message: string,
    sessionId?: Type.Entity.Session['id'],
    correlatorIds: string[] = [],
    messageIds: string[] = []
  ) {
    super(sessionId || '', correlatorIds, messageIds, Chat.Status.SHUTDOWN, message);
    this.operationId = operationId;
  }

  public shouldRetry(): boolean {
    return false;
  }
}
