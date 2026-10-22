import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { Logger, Strategy } from '@moc-global/loft-definitions';
import { AzureClientOptions, AzureOpenAI } from 'openai';
import { ZodObject } from 'zod';

import { OpenAiStrategyOptions } from './OpenAiStrategyOptions';
import { OpenAiRequest, OpenAiResponse, OpenAiResponseChunk, OpenAiStreamRequest } from './OpenAiTypes';
import { OpenAiRequestBodySchema } from './OpenAiValidatingSchemas';
import { generateStreamed, isStreamable } from './streaming/streamChatCompletion';

const log = new Logger('OpenAIStrategy');

export type AzureOpenAiConfig = {
  endpoint?: string;
  deploymentName?: string;
  apiVersion?: string;
  auth:
    | {
        type: 'azure-ad';
        scope?: string;
      }
    | {
        type: 'api-key';
        apiKey: string;
      };
};

export class AzureOpenAiCallStrategy implements Strategy.LLM.LLMApi {
  private readonly client: AzureOpenAI;
  private readonly streaming: boolean;
  private readonly streamUsage: boolean;
  private static readonly DEFAULT_SCOPE = 'https://cognitiveservices.azure.com/.default';

  constructor(
    config: AzureOpenAiConfig,
    readonly tokenRateLimiter: Strategy.LLM.LlmTokenRateLimiter,
    readonly llmTokenizer: Strategy.LLM.LlmTokenizer,
    /** @experimental */
    options?: OpenAiStrategyOptions
  ) {
    // need for using streaming https://github.com/openai/openai-node?tab=readme-ov-file#realtime-api
    const azureConfig: AzureClientOptions = {
      apiVersion: config.apiVersion || (config.deploymentName ? '2024-10-01-preview' : '2024-10-21'),
      // Without an endpoint the SDK reads AZURE_OPENAI_ENDPOINT, or throws if that is unset too
      endpoint: config.endpoint,
      deployment: config.deploymentName,
      timeout: options?.clientOptions?.timeout,
      maxRetries: options?.clientOptions?.maxRetries
    };
    this.streaming = options?.streaming ?? true;
    this.streamUsage = options?.streamUsage ?? true;

    if (config.auth.type === 'api-key') {
      this.client = new AzureOpenAI({
        ...azureConfig,
        apiKey: config.auth.apiKey
      });
    } else if (config.auth.type === 'azure-ad') {
      const credential = new DefaultAzureCredential();
      const scope = config.auth.scope || AzureOpenAiCallStrategy.DEFAULT_SCOPE;
      const azureADTokenProvider = getBearerTokenProvider(credential, scope);

      this.client = new AzureOpenAI({
        ...azureConfig,
        azureADTokenProvider
      });
    } else {
      throw new Error('Invalid auth type');
    }
  }

  async generate<T_LLM_Req, T_LLM_Res>(
    generalRequest: T_LLM_Req,
    options?: Strategy.LLM.CallOptions
  ): Promise<T_LLM_Res> {
    const llmRequest = generalRequest as unknown as OpenAiRequest;
    if (options?.onEvent && this.streaming && isStreamable(llmRequest)) {
      const llmResponse = await generateStreamed(
        (body, callOptions) => this.client.chat.completions.create(body, callOptions),
        llmRequest,
        { signal: options.signal, onEvent: options.onEvent, includeUsage: this.streamUsage }
      );
      return llmResponse as T_LLM_Res;
    }

    try {
      const llmResponse = await this.client.chat.completions.create(llmRequest, { signal: options?.signal });
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
      const stream = await this.client.chat.completions.create({ ...llmRequest, stream: true });
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
