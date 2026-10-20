import { Agent, Type } from '..';

export interface Session {
  focus?: Agent.FocusStateStore;

  create: (newSession: Type.Entity.CreateSession) => Promise<Type.Entity.Session>;

  /** Rejects with `SessionNotFoundError` when the session does not exist */
  getById(sessionId: Type.Entity.Session['id']): Promise<Type.Entity.Session>;
  /** Rejects with `SessionNotFoundError` when no session has this external key */
  getByExternalKey(externalKey: Type.Entity.Session['externalKey']): Promise<Type.Entity.Session>;

  /** Rejects with `SessionNotFoundError` when the session does not exist */
  updateById: (
    sessionId: Type.Entity.Session['id'],
    newSession: Partial<Type.Entity.Session>
  ) => Promise<Type.Entity.Session>;

  /** Rejects with `SessionNotFoundError` when the session does not exist */
  deleteById: (sessionId: Type.Entity.Session['id']) => Promise<void>;

  checkHealth(): Promise<boolean>;

  // end db connection
  end(): Promise<void>;
}
