import { Chat, Interface, Logger, Repository, Strategy, Type } from '@moc-global/loft-definitions';

import { validateToolsIntegrity } from '../utils/toolValidation';

export class GenerateResultMessages implements Chat.GenerateResultMessages {
  public readonly directMessages: Interface.FacadeEntity.InteractiveOutputMessage[];
  public readonly augmentedContext: Interface.FacadeEntity.InteractiveOutputMessage[];
  public readonly llmResponse: Strategy.LLM.UnifiedLLMResponse;
  public readonly sessionId: string;

  private appendFn!: (
    sessionId: Type.Entity.Session['id'],
    messages: Type.Entity.CreateMessage[]
  ) => Promise<Type.Entity.Message[]>;

  private readonly log = new Logger('GenerateResultMessages');

  public setAppendFn(appendFn: Repository.ChatHistory['addMessages']): void {
    this.appendFn = appendFn;
  }

  constructor(
    directMessages: Interface.FacadeEntity.InteractiveOutputMessage[],
    augmentedContext: Interface.FacadeEntity.InteractiveOutputMessage[],
    llmResponse: Strategy.LLM.UnifiedLLMResponse,
    sessionId: string
  ) {
    this.directMessages = directMessages;
    this.augmentedContext = augmentedContext;
    this.llmResponse = llmResponse;
    this.sessionId = sessionId;
  }

  async save(options: Chat.BatchSaveOptions = {}): Promise<Chat.BatchSaveResult> {
    if (!this.appendFn) {
      throw new Error('Batch append function not set. Call setBatchAppendFn() first.');
    }

    // If no options are provided, use the default options for save all messages
    const isOptionsEmpty = !options || Object.keys(options).length === 0;
    const effectiveOptions = isOptionsEmpty
      ? {
          saveDirectMessages: true,
          saveAugmentedContext: true,
          saveToolMessages: true,
          saveAssistantMessage: true
        }
      : options;

    const messagesToSave: Type.Entity.CreateMessage[] = [];

    try {
      // Handle direct messages
      if (this._shouldIncludeSection(effectiveOptions.saveDirectMessages)) {
        const indices = this._getIndicesForSection(effectiveOptions.saveDirectMessages, this.directMessages.length);
        for (const index of indices) {
          if (index >= 0 && index < this.directMessages.length) {
            messagesToSave.push(this.directMessages[index] as Type.Entity.CreateMessage);
          }
        }
      }

      // Handle augmented context
      if (this._shouldIncludeSection(effectiveOptions.saveAugmentedContext)) {
        const indices = this._getIndicesForSection(effectiveOptions.saveAugmentedContext, this.augmentedContext.length);
        for (const index of indices) {
          if (index >= 0 && index < this.augmentedContext.length) {
            messagesToSave.push(this.augmentedContext[index] as Type.Entity.CreateMessage);
          }
        }
      }

      // Handle tool messages (only if validation passed)
      // validateTools used here for be able fix tools array before saving
      if (this._shouldIncludeSection(effectiveOptions.saveToolMessages)) {
        const isToolsValid = validateToolsIntegrity(this.llmResponse.usedTools || []);
        if (isToolsValid) {
          const toolMessages = this.llmResponse.usedTools || [];
          const toolsLength = toolMessages.length;
          const indices = this._getIndicesForSection(effectiveOptions.saveToolMessages, toolsLength);
          for (const index of indices) {
            if (index >= 0 && index < toolsLength) {
              messagesToSave.push(toolMessages[index] as Type.Entity.CreateMessage);
            }
          }
        } else {
          this.log.warn('GenerateResultMessages: Tools are not valid, skipping saving tool messages for this batch');
        }
      }

      // Handle assistant message
      if (this._shouldIncludeSection(effectiveOptions.saveAssistantMessage)) {
        messagesToSave.push(this.llmResponse.topChoice as Type.Entity.CreateMessage);
      }

      if (messagesToSave.length > 0) {
        return await this.appendFn(this.sessionId, messagesToSave);
      }

      return [];
    } catch (error) {
      this.log.error('GenerateResultMessages: Error during batch save:', error);
      throw error;
    }
  }

  private _shouldIncludeSection(option: boolean | number[] | undefined): boolean {
    if (option === undefined) return false;
    if (typeof option === 'boolean') return option;
    return Array.isArray(option) && option.length > 0;
  }

  private _getIndicesForSection(option: boolean | number[] | undefined, arrayLength: number): number[] {
    if (option === undefined || option === false) return [];
    if (option === true) return Array.from({ length: arrayLength }, (_, i) => i);
    if (Array.isArray(option)) return option;
    return [];
  }
}
