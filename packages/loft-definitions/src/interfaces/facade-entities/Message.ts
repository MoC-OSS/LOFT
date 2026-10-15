import { Type } from '../..';

export interface Message extends Type.Entity.Message {
  patch(patch: Partial<Type.Entity.MessagePatch>): Promise<void>;
}

export interface InteractiveOutputMessage extends Type.Entity.CreateMessage {
  setAppendFn(
    appendFn: (sessionId: Type.Entity.Session['id'], message: Type.Entity.CreateMessage) => Promise<Type.Entity.Message>
  ): void;
  append: () => Promise<Type.Entity.Message>;
}
