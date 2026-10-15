import { Type } from '../../..';
import { Chat } from '..';

// This error can only be used in the context of ChatInterface methods.
// This error is related to the decorator responsible for retries mechanism
export abstract class ChatError extends Error {
  public sessionId: string;
  public correlatorIds: string[];
  public messageIds: Type.SMG.Message['id'][];
  public status: Chat.Status;
  public cause?: Error | unknown;
  public details?: any;

  constructor(
    sessionId: string,
    correlatorIds: string[],
    messageIds: string[],
    status: Chat.Status,
    message: string,
    cause?: Error | unknown,
    details?: any
  ) {
    super(message);
    this.name = new.target.name;
    this.sessionId = sessionId;
    this.correlatorIds = correlatorIds;
    this.messageIds = messageIds;
    this.status = status;
    this.cause = cause;
    this.details = details;

    // Add the error stack to the error stack
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target);
    }

    // Add cause stack to the error stack
    if (cause instanceof Error) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }

  public abstract shouldRetry(): boolean;
}
