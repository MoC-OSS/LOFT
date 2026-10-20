import { Chat, Type } from '../../..';
import { ChatError } from './ChatError';

export type SessionNotFoundLookup =
  { sessionId: Type.Entity.Session['id'] } | { externalKey: Type.Entity.Session['externalKey'] };

/**
 * Thrown when a session does not exist, so an application can tell it apart from a database or provider failure
 * (for example to answer 404). A custom `Repository.Session` should throw it as well.
 */
export class SessionNotFoundError extends ChatError {
  /** The external key the session was looked up by; `sessionId` is then empty */
  public externalKey?: Type.Entity.Session['externalKey'];

  constructor(lookup: SessionNotFoundLookup, message?: string) {
    const byId = 'sessionId' in lookup;
    super(
      byId ? lookup.sessionId : '',
      [],
      [],
      Chat.Status.ERROR,
      message ??
        (byId
          ? `Session with id ${lookup.sessionId} not found`
          : `Session with externalKey ${JSON.stringify(lookup.externalKey)} not found`)
    );
    if (!byId) this.externalKey = lookup.externalKey;
  }

  public shouldRetry(): boolean {
    return false;
  }
}
