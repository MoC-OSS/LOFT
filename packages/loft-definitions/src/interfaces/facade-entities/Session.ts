import { Type } from '../..';

export type SessionUpdateData = Partial<
  Pick<Type.Entity.Session, 'currentLlmName' | 'currentManifestName' | 'ctx' | 'focusAgent'>
>;
export interface Session extends Type.Entity.Session {
  update(sessionData?: SessionUpdateData): Promise<void>;
}
