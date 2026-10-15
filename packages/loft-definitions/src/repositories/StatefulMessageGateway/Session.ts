import { Type } from '../..';

export interface Session {
  create(sessionId?: Type.SMG.Session['id']): Promise<Type.SMG.Session>;
  getById(sessionId: Type.SMG.Session['id']): Promise<Type.SMG.Session | undefined>;
  deleteById(sessionId: Type.SMG.Session['id']): Promise<void>;
  getSessionState(sessionId: Type.SMG.Session['id']): Promise<Type.SMG.SessionState>;
}
