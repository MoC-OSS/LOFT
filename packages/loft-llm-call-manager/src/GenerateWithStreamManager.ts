import { Logger, Strategy } from '@moc-global/loft-definitions';

import { GenerateCallManager } from './GenerateManager';
import { GenerateConfig } from './types';
import { delay } from './utils';

const log = new Logger('LlmCallManager');

export class GenerateWithStreamManager<T_LLM_Req, T_LLM_Res> extends GenerateCallManager<T_LLM_Req, T_LLM_Res> {
  constructor(name: string, config: GenerateConfig, llmStrategy: Strategy.LLM.LLMApi) {
    super(name, config, llmStrategy);
  }

  private async makeGenerateStreamRequest(llmRequest: T_LLM_Req, requestedTokens: number): Promise<T_LLM_Res> {
    let attempt = 0;
    let lastError: unknown;

    do {
      try {
        const llmResponse: any = await this.llmStrategy.generateStream<T_LLM_Req, T_LLM_Res>(llmRequest);
        const response = this.responseStreamTokenizer(llmResponse, requestedTokens);
        this.llmStrategy.tokenRateLimiter.setUsedRequest();
        return response as unknown as T_LLM_Res;
      } catch (error) {
        log.error('makeGenerateStreamRequest attempt failed', error);
        lastError = error;
        attempt++;
        if (attempt < this.config.retryAttemptsLimit) {
          await delay(this.config.retryDelay);
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

  async taskPQueueHandler(llmRequest: T_LLM_Req) {
    const totalMessage = this.llmStrategy.reduceMessages(llmRequest);
    const predictedTokens = this.llmStrategy.llmTokenizer.calculateTokensFromString(totalMessage);
    await this.llmStrategy.tokenRateLimiter.awaitBeforeCall(predictedTokens);
    const llmResponse = await this.makeGenerateStreamRequest(llmRequest, predictedTokens);
    return llmResponse;
  }
}
