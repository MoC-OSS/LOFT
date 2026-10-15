import { Type } from '../..';

export interface Message {
  append(message: Type.SMG.CreateMessage[]): Promise<Type.SMG.Message[]>;
  // getByIds(ids: Type.SMG.Message['id'][]): Promise<Type.SMG.Message[]>;
  fetchFifoReadySessionMessages(): Promise<Type.SMG.Message[]>;
  fetchFifoReadySessionMessagesBySessionId(sessionId: string): Promise<Type.SMG.Message[]>;
  fetchFifoMessagesWithStateBySessionId(sessionId: string): Promise<Type.SMG.MessageWithStates[]>;
  deleteBySessionId(sessionId: Type.SMG.Session['id']): Promise<void>;
  removeCompletedMessages(): Promise<void>;
}
