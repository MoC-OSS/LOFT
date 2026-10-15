import { Interface, Logger, Strategy, Type } from '@moc-global/loft-definitions';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodSchema } from 'zod';

import { Content, GeminiRequest, GeminiResponse } from '../VertexAiTypes';
import { organizeMessagesForGemini } from './adapters/messageRequest';
import { formatGeminiResponseToUnified } from './adapters/messageResponse';
import { createGeminiToolsConfig } from './adapters/toolDeclaration';
import { GeminiStream } from './GeminiStream';
import { GeminiValidatingSchema } from './GeminiValidatingSchema';

export class GeminiLoftStrategy extends Strategy.LLM.AbstractLoftLLM<GeminiRequest, GeminiResponse> {
  public readonly llmName: string;
  protected readonly log = new Logger('LLMStrategy:Gemini');

  constructor({ llmName, loftQueue }: Interface.StrategyArgsFacade, callManagerStrategy: Strategy.CallManager) {
    super(callManagerStrategy, loftQueue);
    this.llmName = llmName;
  }

  async formatToLLMRequest(
    _correlatorIds: string[],
    computedSystemMessage: string,
    modelPreset: Type.LLMManifestProps['modelPreset'],
    messages: Type.Entity.Message[],
    mcpTools?: ListToolsResult['tools']
  ): Promise<GeminiRequest> {
    const filteredMessages = messages.filter((msg) => this.shouldIncludeMessage(msg));
    const contents: Content[] = organizeMessagesForGemini(filteredMessages);

    // Get tools config if MCP tools are provided
    const toolsConfig = mcpTools ? createGeminiToolsConfig(mcpTools) : {};

    const llmRequestBody: GeminiRequest = {
      model: modelPreset.model as string,
      contents,
      systemInstruction: {
        role: 'user',
        parts: [{ text: computedSystemMessage }]
      },
      config: {
        maxOutputTokens: modelPreset.max_output_tokens as number | undefined,
        temperature: modelPreset.temperature as number | undefined,
        topP: modelPreset.top_p as number | undefined,
        topK: modelPreset.top_k as number | undefined,
        stopSequences: modelPreset.stop_sequences as string[] | undefined,
        candidateCount: modelPreset.candidate_count as number | undefined,
        ...toolsConfig
      }
    };

    return llmRequestBody;
  }

  formatToUnifiedLLMResponse(
    correlatorIds: string[],
    sessionId: string,
    originalResponse: GeminiResponse,
    llmName: string,
    manifestName: string
  ): Strategy.LLM.UnifiedLLMResponse {
    return formatGeminiResponseToUnified(originalResponse, {
      correlatorIds,
      sessionId,
      llmName,
      manifestName
    });
  }

  async generateStream(llmRequest: Strategy.LLM.LLMRequest<GeminiRequest>): Promise<GeminiStream> {
    if (!this.callManagerStrategy) throw new Error('CallManagerStrategy is not defined');
    const res = await this.callManagerStrategy.streamCall(llmRequest);
    const geminiStream = new GeminiStream();
    res.pipe(geminiStream);
    return geminiStream;
  }

  generateModelPresetSchema(): ZodSchema<unknown> {
    return GeminiValidatingSchema.modelPresetValidationSchema();
  }

  generateResponseSchema(): ZodSchema<unknown> {
    return GeminiValidatingSchema.responseValidationSchema();
  }
}
