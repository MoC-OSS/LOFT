import 'reflect-metadata';

import { Repository, Schema, Type } from '@moc-global/loft-definitions';
import { injectable } from 'inversify';

// Chat History Repository Component for use in Facade Entities and LOFT internal components
@injectable()
export abstract class AbstractChatHistoryManager implements Repository.ChatHistoryManager {
  chatHistoryRepository: Repository.ChatHistory;
  chatHistoryPatcherRepository?: Repository.ChatHistoryPatcher;

  constructor(
    chatHistoryRepository: Repository.ChatHistory,
    chatHistoryPatcherRepository?: Repository.ChatHistoryPatcher
  ) {
    this.chatHistoryRepository = chatHistoryRepository;
    this.chatHistoryPatcherRepository = chatHistoryPatcherRepository;
  }

  async addMessages(
    sessionId: Type.Entity.Session['id'],
    messages: Type.Entity.CreateMessage[]
  ): Promise<Type.Entity.ChatHistory> {
    // Messages may be built from request data, so one must not be written into another session
    const foreign = messages.find((message) => message.sessionId !== sessionId);
    if (foreign) {
      throw new Error(`Cannot add a message of session ${foreign.sessionId} to session ${sessionId}`);
    }
    return await this.chatHistoryRepository.addMessages(sessionId, messages);
  }

  // Chat History Repository
  async getMessages(sessionId: Type.Entity.Session['id']): Promise<Type.Entity.Message[]> {
    const chatHistory = await this.chatHistoryRepository.getMessages(sessionId);
    const patches = await this.chatHistoryPatcherRepository?.getPatches(sessionId);
    if (!patches) return chatHistory;
    return patchMessages(chatHistory, patches);
  }

  // Chat History Patcher Repository
  // async addBeforeMessage(
  //   sessionId: Type.Entity.Session['id'],
  //   messageId: Type.Entity.Message['id'],
  //   messages: Type.Entity.CreateMessage[]
  // ): Promise<Type.Entity.ChatHistory> {
  //   if (!this.chatHistoryPatcherRepository) {
  //     throw new Error('ChatHistoryPatcherRepository is not provided');
  //   }
  //   return this.chatHistoryPatcherRepository.addBeforeMessage(sessionId, messageId, messages);
  // }

  // Chat History Patcher Repository
  async patchMessages(
    sessionId: Type.Entity.Session['id'],
    messages: Type.Entity.Message[],
    patchData: Partial<Type.Entity.MessagePatch>
  ): Promise<Type.Entity.Message[]> {
    if (!this.chatHistoryPatcherRepository) throw new Error('ChatHistoryPatcherRepository is not provided');

    const validatedPatchData = Schema.Entity.MessagePatch.partial().parse(patchData);

    const messageIds = messages.map((message) => message.id);

    const patches = await this.chatHistoryPatcherRepository.patchMessages(sessionId, messageIds, validatedPatchData);

    return patchMessages(messages, patches);
  }
  // Patcher Repository
  // async addAfterMessage(
  //   sessionId: Type.Entity.Session['id'],
  //   messageId: Type.Entity.Message['id'],
  //   messages: Type.Entity.CreateMessage[]
  // ): Promise<Type.Entity.ChatHistory> {
  //   if (!this.chatHistoryPatcherRepository) throw new Error('ChatHistoryPatcherRepository is not provided');

  //   return this.chatHistoryPatcherRepository.addAfterMessage(sessionId, messageId, messages);
  // }

  async checkHealth(): Promise<boolean> {
    const [chatHistoryHealth, patcherHealth] = await Promise.all([
      this.chatHistoryRepository.checkHealth(),
      this.chatHistoryPatcherRepository?.checkHealth()
    ]);
    if (!this.chatHistoryPatcherRepository || !patcherHealth) {
      return chatHistoryHealth;
    }

    return chatHistoryHealth && patcherHealth;
  }

  // end db connection
  async end(): Promise<void> {
    await Promise.all([this.chatHistoryRepository.end(), this.chatHistoryPatcherRepository?.end()]);
  }
}

function applyPatch(message: Type.Entity.Message, patch: Type.Entity.MessagePatch): void {
  if (patch.content !== undefined) message.content = patch.content;
  if (patch.role !== undefined) message.role = patch.role;
  if (patch.author !== undefined) message.author = patch.author;
  if (patch.llmName !== undefined) message.llmName = patch.llmName;
  if (patch.manifestName !== undefined) message.manifestName = patch.manifestName;
  if (patch.llmIgnore !== undefined) message.llmIgnore = patch.llmIgnore;
  if (patch.ctx !== undefined) message.ctx = patch.ctx;
}

function toMessageEntity(message: Type.Entity.Message): Type.Entity.Message {
  return {
    id: message.id,
    sessionId: message.sessionId,
    sequenceId: message.sequenceId,
    ctx: message.ctx,
    content: message.content,
    role: message.role,
    author: message.author,
    llmName: message.llmName,
    manifestName: message.manifestName,
    llmIgnore: message.llmIgnore,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt
  };
}

export function patchMessages(
  messages: Type.Entity.Message[],
  patches: Type.Entity.MessagePatch[]
): Type.Entity.Message[] {
  // Copy the fields one by one rather than with a spread: Message instances keep ctx behind a getter,
  // which a spread drops, and carry internal fields that must not reach the result
  const immutableMessages = messages.map(toMessageEntity);

  // Sort all patches by sequenceId to ensure correct order of application
  const sortedPatches = [...patches].sort((a, b) => parseInt(a.sequenceId) - parseInt(b.sequenceId));

  // Iterate through patches and apply them to corresponding messages
  sortedPatches.forEach((patch) => {
    const messageIndex = immutableMessages.findIndex((msg) => msg.id === patch.messageId);
    if (messageIndex !== -1) {
      const message = immutableMessages[messageIndex];
      applyPatch(message, patch);
    }
  });

  return immutableMessages;
}
