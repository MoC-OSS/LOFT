import { Interface, QueryByArrayOfObjects, Repository, Type, Util } from '@moc-global/loft-definitions';

import { Message } from './Message';

export class ChatHistory implements Interface.FacadeEntity.ChatHistory {
  messages: QueryByArrayOfObjects<Interface.FacadeEntity.Message>;

  constructor(
    private readonly sessionId: string,
    private readonly chatHistoryManager: Repository.ChatHistoryManager,
    messages: Type.Entity.Message[] | Interface.FacadeEntity.Message[]
  ) {
    this.messages = new Util.QueryByArrayOfObjects(
      ...messages.map((msgData) => new Message(this.chatHistoryManager, msgData))
    );
  }

  async addMessages(newMessages: Type.Entity.CreateMessage[]): Promise<Type.Entity.Message[]> {
    if (!newMessages.length) throw new Error('No messages to append to chat history.');

    if (newMessages.some((msg) => msg.sessionId !== this.sessionId)) {
      throw new Error('All messages must have the same sessionId as the chat history.');
    }

    const appendedMessages = await this.chatHistoryManager.addMessages(this.sessionId, newMessages);

    this.messages.push(...appendedMessages.map((msg) => new Message(this.chatHistoryManager, msg)));

    return appendedMessages;
  }

  async patchMessages(messageIds: Type.Entity.Message['id'][], patch: Type.Entity.MessagePatch): Promise<void> {
    const messages = this.messages.filter((msg) => messageIds.includes(msg.id));

    const patchedMessages = await this.chatHistoryManager.patchMessages(this.sessionId, messages, patch);

    // Update messages directly - simple and clear approach
    patchedMessages.forEach((patchedMessage) => {
      const index = this.messages.findIndex((msg) => msg.id === patchedMessage.id);
      if (index !== -1) {
        this.messages[index] = new Message(this.chatHistoryManager, patchedMessage);
      }
    });
  }
}
