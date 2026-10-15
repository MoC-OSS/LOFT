import { Interface, QueryByArrayOfObjects, Type } from '../..';

export interface ChatHistory {
  messages: QueryByArrayOfObjects<Interface.FacadeEntity.Message>;

  addMessages(messages: Type.Entity.CreateMessage[]): Promise<Type.Entity.Message[]>;

  // addBeforeMessage(messageId: Type.Entity.Message['id'], messages: Type.Entity.CreateMessage[]): Promise<void>;

  patchMessages(messageIds: Type.Entity.Message['id'][], patch: Type.Entity.MessagePatch): Promise<void>;

  // addAfterMessage(messageId: Type.Entity.Message['id'], messages: Type.Entity.CreateMessage[]): Promise<void>;
}
