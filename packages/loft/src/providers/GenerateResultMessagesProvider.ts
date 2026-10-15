import {
  Chat,
  DI_TYPES,
  InteractiveOutputMessage,
  Interface,
  Logger,
  Repository,
  Strategy,
  Type
  // UsedToolMessage,
  // validateToolsIntegrity
} from '@moc-global/loft-definitions';
import { inject, injectable } from 'inversify';

import { GenerateResultMessages } from '../entities';
import { UsedToolMessage, validateToolsIntegrity } from '../utils/toolValidation';
import { createSingleUseAppendMessageFunction } from '../workflows/chat/util';

export interface GenerateResultMessagesProviderInterface {
  create(
    directMessages: Type.Entity.CreateMessage[],
    augmentedContext: Type.Entity.CreateMessage[],
    llmResponse: Strategy.LLM.UnifiedLLMResponse,
    sessionId: string
  ): Chat.GenerateResultMessages;
}

@injectable()
export class GenerateResultMessagesProvider implements GenerateResultMessagesProviderInterface {
  private readonly appendFn: Repository.ChatHistory['addMessages'];
  private readonly log = new Logger('GenerateResultMessagesProvider');

  constructor(@inject(DI_TYPES.ChatHistoryManager) private readonly chatHistoryManager: Repository.ChatHistoryManager) {
    this.appendFn = this.chatHistoryManager.addMessages.bind(this.chatHistoryManager);
  }

  private injectAppendFnIntoMessage(message: Interface.FacadeEntity.InteractiveOutputMessage): void {
    const oneTimeAppendFn = createSingleUseAppendMessageFunction(this.appendFn);
    message.setAppendFn(oneTimeAppendFn);
  }

  private injectAppendFnIntoMessages(messages: Interface.FacadeEntity.InteractiveOutputMessage[]): void {
    messages.forEach((message) => this.injectAppendFnIntoMessage(message));
  }

  private injectAppendFnIntoLLMResponse(llmResponse: Strategy.LLM.UnifiedLLMResponse): void {
    const topChoiceOneTimeAppendFn = createSingleUseAppendMessageFunction(this.appendFn);
    llmResponse.topChoice.setAppendFn(topChoiceOneTimeAppendFn);
    llmResponse.choices[0].setAppendFn(topChoiceOneTimeAppendFn);

    //choices[0] is already set to topChoiceOneTimeAppendFn so we need to start from 1 for the rest of the choices
    this.injectAppendFnIntoMessages(llmResponse.choices.slice(1));
  }

  private injectAppendFnIntoUsedTools(usedTools: UsedToolMessage[]): void {
    validateToolsIntegrity(usedTools);

    this.injectAppendFnIntoMessages(usedTools);

    this.log.debug(`GenerateResultMessages: Injected real appendFn to ${usedTools.length} tool messages`);
  }

  create(
    directMessages: Interface.FacadeEntity.InteractiveOutputMessage[],
    augmentedContext: Interface.FacadeEntity.InteractiveOutputMessage[],
    llmResponse: Strategy.LLM.UnifiedLLMResponse,
    sessionId: string
  ): Chat.GenerateResultMessages {
    this.log.trace('Creating GenerateResultMessages instance', { sessionId });

    // Ensure all messages are InteractiveOutputMessage instances
    directMessages = directMessages.map((m) =>
      m instanceof InteractiveOutputMessage ? m : new InteractiveOutputMessage(m)
    );
    augmentedContext = augmentedContext.map((m) =>
      m instanceof InteractiveOutputMessage ? m : new InteractiveOutputMessage(m)
    );

    // const boundAppendFn = this.chatHistoryManager.addMessages.bind(this.chatHistoryManager);
    const usedTools = llmResponse?.usedTools || [];
    this.injectAppendFnIntoLLMResponse(llmResponse);
    this.injectAppendFnIntoUsedTools(usedTools);
    this.injectAppendFnIntoMessages(directMessages);
    this.injectAppendFnIntoMessages(augmentedContext);

    const response = new GenerateResultMessages(directMessages, augmentedContext, llmResponse, sessionId);

    response.setAppendFn(this.appendFn);

    this.log.debug('GenerateResultMessages instance created successfully', {
      sessionId,
      directMessageCount: directMessages.length,
      augmentedContextCount: augmentedContext.length,
      toolMessageCount: usedTools.length,
      hasAssistantMessage: !!llmResponse.topChoice
    });

    return response;
  }
}
