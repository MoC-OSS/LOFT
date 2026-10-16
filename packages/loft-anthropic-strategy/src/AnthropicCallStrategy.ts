import Anthropic, { ClientOptions } from '@anthropic-ai/sdk';
import { Logger, Strategy } from '@moc-global/loft-definitions';
import { ZodSchema } from 'zod';
import { z } from 'zod';

const log = new Logger('AnthropicStrategy');

export class AnthropicCallStrategy implements Strategy.LLM.LLMApi {
  private readonly client: Anthropic;

  constructor(
    config: ClientOptions,
    readonly tokenRateLimiter: Strategy.LLM.LlmTokenRateLimiter,
    readonly llmTokenizer: Strategy.LLM.LlmTokenizer
  ) {
    this.client = new Anthropic({
      ...config
    });
  }

  async generate<T_LLM_Req, T_LLM_Res>(
    generalRequest: T_LLM_Req,
    options?: Strategy.LLM.CallOptions
  ): Promise<T_LLM_Res> {
    try {
      const anthropicRequest = this.transformToAnthropicRequest(generalRequest);
      const response = await this.client.messages.create(anthropicRequest, { signal: options?.signal });
      return response as unknown as T_LLM_Res;
    } catch (error) {
      log.error('generate failed', error);
      throw error;
    }
  }

  async generateStream<T_LLM_Req, T_LLM_Res>(generalRequest: T_LLM_Req): Promise<T_LLM_Res> {
    try {
      const anthropicRequest = this.transformToAnthropicRequest({ ...generalRequest, stream: true });
      const stream = await this.client.messages.create(anthropicRequest);
      return stream as unknown as T_LLM_Res;
    } catch (error) {
      log.error('generateStream failed', error);
      throw error;
    }
  }

  extractContentFromChunk<T_LLM_Res>(chunk: T_LLM_Res): string {
    const event = chunk as unknown as Anthropic.MessageStreamEvent;

    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      return event.delta.text || '';
    }

    return '';
  }

  reduceMessages<T_LLM_Req>(generalRequest: T_LLM_Req): string {
    const anthropicRequest = generalRequest as unknown as Anthropic.MessageCreateParams;
    return JSON.stringify(anthropicRequest.messages);
  }

  extractUsedTokens<T_LLM_Res>(generalResponse: T_LLM_Res): number {
    const response = generalResponse as unknown as Anthropic.Message;
    if (response.usage) {
      return response.usage.input_tokens + response.usage.output_tokens;
    }
    return 0;
  }

  generateRequestValidationSchema(): ZodSchema<any> {
    // Return a simple empty object schema as a placeholder
    return z.object({}) as ZodSchema<any>;
  }

  private transformToAnthropicRequest<T_LLM_Req>(generalRequest: T_LLM_Req): Anthropic.MessageCreateParams {
    const request = generalRequest as any;
    const stream = request.stream !== undefined ? request.stream : false;

    const anthropicRequest = {
      model: request.model,
      max_tokens: request.max_tokens,
      messages: request.messages,
      system: request.system,
      temperature: request.temperature,
      top_p: request.top_p,
      top_k: request.top_k,
      stop_sequences: request.stop_sequences,
      tools: request.tools,
      metadata: request.metadata,
      tool_choice: request.tool_choice,
      thinking: request.thinking,
      output_config: request.output_config,
      service_tier: request.service_tier,
      inference_geo: request.inference_geo,
      cache_control: request.cache_control,
      stream
    };

    return anthropicRequest;
  }
}
