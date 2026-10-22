import { Interface, Logger, Strategy, Type } from '@moc-global/loft-definitions';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodObject } from 'zod';

import { mcpToOpenAITool } from './adapters/mcpTool';
import { openAiChoiceToUnifiedMessage, openAiUsageToUnified } from './adapters/OpenAiToUnified';
import { unifiedMessagesToOpenAiMessages } from './adapters/UnifiedToOpenAi';
import { OpenAiStream } from './OpenAiStream';
import { OpenAiRequest, OpenAiResponse } from './OpenAiTypes';
import { OpenAiValidatingSchemas } from './OpenAiValidatingSchemas';

export class AzureOpenAiLoftStrategy extends Strategy.LLM.AbstractLoftLLM<OpenAiRequest, OpenAiResponse> {
  public readonly llmName: string;
  protected readonly log = new Logger('LLMStrategy:AzureOpenAi');

  constructor({ llmName, loftQueue }: Interface.StrategyArgsFacade, callManagerStrategy: Strategy.CallManager) {
    super(callManagerStrategy, loftQueue);
    this.llmName = llmName;
  }

  async formatToLLMRequest(
    correlatorIds: string[],
    computedSystemMessage: string,
    modelPreset: Type.LLMManifestProps['modelPreset'],
    messages: Type.Entity.Message[],
    mcpTools: ListToolsResult['tools']
  ): Promise<OpenAiRequest> {
    const openAiMessages: OpenAiRequest['messages'] = [
      {
        role: 'system',
        content: computedSystemMessage
      },
      ...unifiedMessagesToOpenAiMessages(messages)
    ];

    const openAiTools = mcpToOpenAITool(mcpTools);

    const llmBody = {
      ...modelPreset,
      messages: openAiMessages,
      tools: openAiTools
    } as OpenAiRequest;

    return llmBody;
  }

  formatToUnifiedLLMResponse(
    correlatorIds: string[],
    sessionId: string,
    originalResponse: OpenAiResponse,
    llmName: string,
    manifestName: string
  ): Strategy.LLM.UnifiedLLMResponse {
    const choices = originalResponse.choices.map((aChoice) =>
      openAiChoiceToUnifiedMessage(aChoice, { correlatorIds, sessionId, llmName, manifestName })
    );

    const usage: Strategy.LLM.UnifiedUsage = openAiUsageToUnified(
      originalResponse.usage,
      originalResponse.model,
      originalResponse.choices[0]?.finish_reason
    );

    return {
      choices,
      topChoice: choices[0],
      usage,
      originalResponse
    };
  }

  /**
   * @deprecated Use chat.generate({ onEvent }) instead.
   * Removed in the next major release.
   */
  async generateStream(llmRequest: Strategy.LLM.LLMRequest<OpenAiRequest>): Promise<OpenAiStream> {
    if (!this.callManagerStrategy)
      throw new Error('Cannot use streamCall method when callManagerStrategy is not provided');
    const res = await this.callManagerStrategy.streamCall(llmRequest);
    const openAiStream = new OpenAiStream();
    res.pipe(openAiStream);

    return openAiStream;
  }

  generateModelPresetSchema() {
    return OpenAiValidatingSchemas.modelPresetValidationSchema();
  }

  generateResponseSchema(): ZodObject<any> {
    return OpenAiValidatingSchemas.responseValidationSchema();
  }
}
