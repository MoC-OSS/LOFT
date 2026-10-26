import { Chat, Type } from '../../..';
import { ChatError } from './ChatError';

/** @experimental Part of the Queued execution mode, which is not implemented yet. May change or be removed in any release. */
export class AppendMessageError extends ChatError {
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
    return false;
  }
}
