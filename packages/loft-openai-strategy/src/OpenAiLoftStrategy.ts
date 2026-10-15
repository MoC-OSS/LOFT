import { Interface, Logger, Strategy, Type } from '@moc-global/loft-definitions';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodSchema } from 'zod';

import { mcpToOpenAITool } from './adapters/mcpTool';
import { openAiChoiceToUnifiedMessage } from './adapters/OpenAiToUnified';
import { unifiedMessagesToOpenAiMessages } from './adapters/UnifiedToOpenAi';
import { OpenAiStream } from './OpenAiStream';
import { OpenAiRequest, OpenAiResponse } from './OpenAiTypes';
import { OpenAiValidatingSchemas } from './OpenAiValidatingSchemas';

export class OpenAiLoftStrategy extends Strategy.LLM.AbstractLoftLLM<OpenAiRequest, OpenAiResponse> {
  public readonly llmName: string;
  protected readonly log = new Logger('LLMStrategy:OpenAi');

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

    // Extract usage in OpenAI format (always provide values, use 0 if missing)
    const usage: Strategy.LLM.UnifiedUsage = {
      inputTokens: originalResponse.usage?.prompt_tokens || 0,
      outputTokens: originalResponse.usage?.completion_tokens || 0,
      totalTokens: originalResponse.usage?.total_tokens || 0,
      reasoningTokens: (originalResponse.usage as any)?.reasoning_tokens,
      model: originalResponse.model,
      finishReason: originalResponse.choices[0]?.finish_reason
    };

    return {
      choices,
      topChoice: choices[0],
      usage,
      originalResponse
    };
  }

  async generateStream(llmRequest: Strategy.LLM.LLMRequest<OpenAiRequest>): Promise<OpenAiStream> {
    if (!this.callManagerStrategy)
      throw new Error('Cannot use streamCall method when callManagerStrategy is not provided');
    const res = await this.callManagerStrategy.streamCall(llmRequest);
    const openAiStream = new OpenAiStream();
    res.pipe(openAiStream);

    return openAiStream;
  }

  generateModelPresetSchema(): ZodSchema<any> {
    return OpenAiValidatingSchemas.modelPresetValidationSchema();
  }

  generateResponseSchema(): ZodSchema<any> {
    return OpenAiValidatingSchemas.responseValidationSchema();
  }
}
