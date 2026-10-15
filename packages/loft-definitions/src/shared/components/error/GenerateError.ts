import { Chat, Type } from '../../..';
import { ChatError } from './ChatError';
export class GenerateError extends ChatError {
  constructor(
    sessionId: Type.Entity.Session['id'],
    correlatorIds: string[],
    messageIds: string[],
    status: Chat.Status,
    message: string,
    cause?: Error | unknown,
    details?: any
  ) {
    super(sessionId, correlatorIds, messageIds, status, message, cause, details);
  }

  public shouldRetry(): boolean {
    return this.status === Chat.Status.LOCKED;
  }
}
