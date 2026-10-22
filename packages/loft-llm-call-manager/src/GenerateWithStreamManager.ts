import { isRetryableError, Logger, retryDelayMs, Strategy, waitForRetry } from '@moc-global/loft-definitions';

import { GenerateCallManager } from './GenerateManager';
import { GenerateConfig } from './types';

const log = new Logger('LlmCallManager');

/**
 * @deprecated Use chat.generate({ onEvent }) instead.
 * Removed in the next major release.
 */
export class GenerateWithStreamManager<T_LLM_Req, T_LLM_Res> extends GenerateCallManager<T_LLM_Req, T_LLM_Res> {
  constructor(name: string, config: GenerateConfig, llmStrategy: Strategy.LLM.LLMApi) {
    super(name, config, llmStrategy);
  }

  private async makeGenerateStreamRequest(
    llmRequest: T_LLM_Req,
    requestedTokens: number,
    options?: Strategy.LLM.CallOptions
  ): Promise<T_LLM_Res> {
    let attempt = 0;
    let lastError: unknown;

    do {
      try {
        const llmResponse: any = await this.llmStrategy.generateStream<T_LLM_Req, T_LLM_Res>(llmRequest);
        const response = this.responseStreamTokenizer(llmResponse, requestedTokens);
        this.llmStrategy.tokenRateLimiter.setUsedRequest();
        return response as unknown as T_LLM_Res;
      } catch (error) {
        // The same policy as GenerateCallManager: no retry after an abort, or for a 400, 401 or 404
        if (options?.signal?.aborted || !isRetryableError(error)) throw error;
        log.error('makeGenerateStreamRequest attempt failed', error);
        lastError = error;
        attempt++;
        if (attempt < this.config.retryAttemptsLimit) {
          await waitForRetry(retryDelayMs(error, attempt, this.config.retryDelay), options?.signal);
        }
      }
    } while (attempt < this.config.retryAttemptsLimit);

    log.error('makeGenerateStreamRequest failed after retries');
    throw lastError;
  }

  private async *responseStreamTokenizer(
    llmResponse: any,
    requestedTokens: number
  ): AsyncGenerator<Buffer, void, unknown> {
    let data = '';
    try {
      for await (const chunk of llmResponse) {
        data += this.llmStrategy.extractContentFromChunk(chunk);
        yield chunk;
      }

      const usedTokens = requestedTokens + this.llmStrategy.llmTokenizer.calculateTokensFromString(data);
      this.llmStrategy.tokenRateLimiter.setUsedTokens(usedTokens);
    } catch (error) {
      log.error('responseStreamTokenizer failed', error);
      if (data.length > 0) {
        const usedTokens = requestedTokens + this.llmStrategy.llmTokenizer.calculateTokensFromString(data);
        this.llmStrategy.tokenRateLimiter.setUsedTokens(usedTokens);
      }
      throw error;
    }
  }

  async taskPQueueHandler(llmRequest: T_LLM_Req, options?: Strategy.LLM.CallOptions) {
    const totalMessage = this.llmStrategy.reduceMessages(llmRequest);
    const predictedTokens = this.llmStrategy.llmTokenizer.calculateTokensFromString(totalMessage);
    await this.llmStrategy.tokenRateLimiter.awaitBeforeCall(predictedTokens);
    options?.signal?.throwIfAborted();
    const llmResponse = await this.makeGenerateStreamRequest(llmRequest, predictedTokens, options);
    return llmResponse;
  }
}
