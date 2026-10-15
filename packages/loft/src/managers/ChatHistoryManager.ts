import { DI_TYPES, Repository } from '@moc-global/loft-definitions';
import { inject, injectable, optional } from 'inversify';

import { AbstractChatHistoryManager } from './AbstractChatHistoryManager';

@injectable()
export class ChatHistoryManager extends AbstractChatHistoryManager {
  constructor(
    @inject(DI_TYPES.ChatHistoryRepository) chatHistoryRepository: Repository.ChatHistory,
    @inject(DI_TYPES.ChatHistoryPatcherRepository)
    @optional()
    chatHistoryPatcherRepository?: Repository.ChatHistoryPatcher
  ) {
    super(chatHistoryRepository, chatHistoryPatcherRepository);
  }
}
