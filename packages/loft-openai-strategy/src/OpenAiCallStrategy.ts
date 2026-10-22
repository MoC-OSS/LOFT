import { Logger, Strategy } from '@moc-global/loft-definitions';
import { ZodObject } from 'zod';

import { OpenAiStrategyOptions } from './OpenAiStrategyOptions';
import { OpenAiLlm, OpenAiRequest, OpenAiResponse, OpenAiResponseChunk, OpenAiStreamRequest } from './OpenAiTypes';
import { OpenAiRequestBodySchema } from './OpenAiValidatingSchemas';
import { generateStreamed, isStreamable } from './streaming/streamChatCompletion';

const log = new Logger('OpenAIStrategy');

export class OpenAiCallStrategy implements Strategy.LLM.LLMApi {
  private readonly openAi: OpenAiLlm.OpenAI;
  private readonly streaming: boolean;
  private readonly streamUsage: boolean;

  constructor(
    private readonly apiKey: string,
    readonly tokenRateLimiter: Strategy.LLM.LlmTokenRateLimiter,
    readonly llmTokenizer: Strategy.LLM.LlmTokenizer,
    /** @experimental */
    options?: OpenAiStrategyOptions
  ) {
    this.openAi = new OpenAiLlm.OpenAI({
      apiKey,
      timeout: options?.clientOptions?.timeout,
      maxRetries: options?.clientOptions?.maxRetries
    });
    this.streaming = options?.streaming ?? true;
    this.streamUsage = options?.streamUsage ?? true;
  }

  async generate<T_LLM_Req, T_LLM_Res>(
    generalRequest: T_LLM_Req,
    options?: Strategy.LLM.CallOptions
  ): Promise<T_LLM_Res> {
    const llmRequest = generalRequest as unknown as OpenAiRequest;
    if (options?.onEvent && this.streaming && isStreamable(llmRequest)) {
      const llmResponse = await generateStreamed(
        (body, callOptions) => this.openAi.chat.completions.create(body, callOptions),
        llmRequest,
        { signal: options.signal, onEvent: options.onEvent, includeUsage: this.streamUsage }
      );
      return llmResponse as T_LLM_Res;
    }

    try {
      const llmResponse = await this.openAi.chat.completions.create(llmRequest, { signal: options?.signal });
      return llmResponse as T_LLM_Res;
    } catch (error) {
      log.error('generate failed', error);
      throw error;
    }
  }

  /**
   * @deprecated Use chat.generate({ onEvent }) instead.
   * Removed in the next major release.
   */
  async generateStream<T_LLM_Req, T_LLM_Res>(generalRequest: T_LLM_Req): Promise<T_LLM_Res> {
    try {
      const llmRequest = generalRequest as unknown as OpenAiStreamRequest;
      const stream = await this.openAi.chat.completions.create({ ...llmRequest, stream: true });
      return stream as unknown as T_LLM_Res;
    } catch (error) {
      log.error('generateStream failed', error);
      throw error;
    }
  }

  /**
   * @deprecated Use chat.generate({ onEvent }) instead.
   * Removed in the next major release.
   */
  extractContentFromChunk<T_LLM_Res>(chunk: T_LLM_Res): string {
    const response = chunk as unknown as OpenAiResponseChunk;
    return response.choices[0]?.delta?.content || '';
  }

  reduceMessages<T_LLM_Req>(generalRequest: T_LLM_Req) {
    const llmRequest = generalRequest as unknown as OpenAiRequest;
    return JSON.stringify(llmRequest.messages);
  }

  extractUsedTokens<T_LLM_Res>(generalResponse: T_LLM_Res): number {
    const llmResponse = generalResponse as unknown as OpenAiResponse;
    return llmResponse.usage?.total_tokens || 500;
  }

  generateRequestValidationSchema(): ZodObject<any> {
    return OpenAiRequestBodySchema;
  }
}
