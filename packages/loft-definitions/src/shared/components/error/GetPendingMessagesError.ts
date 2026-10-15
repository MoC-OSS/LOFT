import { Chat, Type } from '../../..';
import { ChatError } from './ChatError';

/** @experimental Part of the Stream and Queued execution modes, which are not implemented yet. May change or be removed in any release. */
export class GetPendingMessagesError extends ChatError {
  constructor(
    sessionId: Type.Entity.Session['id'],
    status: Chat.Status,
    message: string,
    cause?: Error | unknown,
    details?: any
  ) {
    super(sessionId, [], [], status, message, cause, details);
  }

  public shouldRetry(): boolean {
    return this.status === Chat.Status.LOCKED;
  }
}
