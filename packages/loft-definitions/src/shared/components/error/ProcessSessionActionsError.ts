import { Chat, Type } from '../../..';
import { ChatError } from './ChatError';

/** @experimental Part of the Queued execution mode, which is not implemented yet. May change or be removed in any release. */
export class ProcessSessionActionsError extends ChatError {
  public sessionActionsResult: Chat.SMGActionResult[];

  constructor(
    sessionId: Type.Entity.Session['id'],
    correlatorIds: string[],
    messageIds: string[],
    status: Chat.Status,
    message: string,
    sessionActionsResult: Chat.SMGActionResult[],
    cause?: Error | unknown,
    details?: any
  ) {
    super(sessionId, correlatorIds, messageIds, status, message, cause, details);
    this.sessionActionsResult = sessionActionsResult;
  }

  public shouldRetry(): boolean {
    return this.status === Chat.Status.LOCKED;
  }
}
