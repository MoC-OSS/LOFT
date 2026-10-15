import { GoogleGenAI } from '@google/genai';
import { Logger, Strategy } from '@moc-global/loft-definitions';

import { GeminiStrategyConfig } from '../VertexAiStrategyConfig';
import { GeminiRequest, GeminiResponse } from '../VertexAiTypes';
import { GeminiRequestBodySchema } from './GeminiValidatingSchema';

const log = new Logger('GeminiStrategy');

export class GeminiCallStrategy implements Strategy.LLM.LLMApi {
  private readonly ai: GoogleGenAI;

  constructor(
    config: GeminiStrategyConfig,
    readonly tokenRateLimiter: Strategy.LLM.LlmTokenRateLimiter,
    readonly llmTokenizer: Strategy.LLM.LlmTokenizer
  ) {
    if (config.mode === 'vertexai') {
      this.ai = new GoogleGenAI({
        vertexai: true,
        project: config.project,
        location: config.location || 'us-central1'
      });
    } else {
      this.ai = new GoogleGenAI({
        apiKey: config.apiKey
      });
    }
  }

  async generate<T_LLM_Req, T_LLM_Res>(
    generalRequest: T_LLM_Req,
    options?: Strategy.LLM.CallOptions
  ): Promise<T_LLM_Res> {
    try {
      const llmRequest = generalRequest as unknown as GeminiRequest;

      const response = await this.ai.models.generateContent({
        model: llmRequest.model,
        contents: llmRequest.contents,
        config: {
          systemInstruction: llmRequest.systemInstruction,
          ...llmRequest.config,
          abortSignal: options?.signal
        }
      });

      return response as T_LLM_Res;
    } catch (error) {
      log.error('generate failed', error);
      throw error;
    }
  }

  async generateStream<T_LLM_Req, T_LLM_Res>(generalRequest: T_LLM_Req): Promise<T_LLM_Res> {
    try {
      const llmRequest = generalRequest as unknown as GeminiRequest;

      const responseStream = await this.ai.models.generateContentStream({
        model: llmRequest.model,
        contents: llmRequest.contents,
        config: {
          systemInstruction: llmRequest.systemInstruction,
          ...llmRequest.config
        }
      });

      return responseStream as T_LLM_Res;
    } catch (error) {
      log.error('generateStream failed', error);
      throw error;
    }
  }

  extractContentFromChunk<T_LLM_Res>(chunk: T_LLM_Res): string {
    const response = chunk as unknown as GeminiResponse;
    return response.text || '';
  }

  extractUsedTokens<T_LLM_Res>(generalResponse: T_LLM_Res) {
    const response = generalResponse as unknown as GeminiResponse;
    return response?.usageMetadata?.totalTokenCount || 0;
  }

  reduceMessages<T_LLM_Req>(generalRequest: T_LLM_Req) {
    const llmRequest = generalRequest as unknown as GeminiRequest;
    return JSON.stringify(llmRequest);
  }

  generateRequestValidationSchema() {
    return GeminiRequestBodySchema;
  }
}
