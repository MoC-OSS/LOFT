import { Type } from '..';

export interface ChatHistory {
  addMessages(
    sessionId: Type.Entity.Session['id'],
    messages: Type.Entity.CreateMessage[]
  ): Promise<Type.Entity.Message[]>;

  getMessages(sessionId: Type.Entity.Session['id']): Promise<Type.Entity.Message[]>;

  checkHealth(): Promise<boolean>;

  end(): Promise<void>;
}

export interface ChatHistoryPatcher {
  getPatches(sessionId: Type.Entity.Session['id']): Promise<Type.Entity.MessagePatch[]>;

  // addBeforeMessage(
  //   sessionId: Type.Entity.Session['id'],
  //   messageId: Type.Entity.Message['id'],
  //   messages: Type.Entity.CreateMessage[]
  // ): Promise<Type.Entity.ChatHistory>;

  patchMessages(
    sessionId: Type.Entity.Session['id'],
    messageIds: Type.Entity.Message['id'][],
    patchData: Partial<Type.Entity.CreateMessagePatch>
  ): Promise<Type.Entity.MessagePatch[]>;

  // addAfterMessage(
  //   sessionId: Type.Entity.Session['id'],
  //   messageId: Type.Entity.Message['id'],
  //   messages: Type.Entity.CreateMessage[]
  // ): Promise<Type.Entity.ChatHistory>;

  checkHealth(): Promise<boolean>;

  end(): Promise<void>;
}

export interface ChatHistoryManager extends Omit<ChatHistoryPatcher, 'patchMessages' | 'getPatches'>, ChatHistory {
  patchMessages(
    sessionId: Type.Entity.Session['id'],
    messages: Type.Entity.Message[],
    patchData: Partial<Type.Entity.CreateMessagePatch>
  ): Promise<Type.Entity.Message[]>;
}
