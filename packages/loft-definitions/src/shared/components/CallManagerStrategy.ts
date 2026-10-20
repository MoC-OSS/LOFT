import axios, { AxiosResponse } from 'axios';

import * as Strategy from '../../strategies';
import { isRetryableError, retryDelayMs, waitForRetry } from '../utils/retryPolicy';
import { Logger } from './Logger';

const log = new Logger('CallManagerStrategy');

export interface CallManagerAdapterConfig {
  llmCallManagerUrl: string;
  retryAttempts: number;
  /** The base of the exponential backoff between attempts, in ms. Default: 500 */
  retryDelay?: number;
}

const DEFAULT_RETRY_DELAY_MS = 500;

export class HttpCallManagerStrategy implements Strategy.CallManager {
  constructor(private readonly config: CallManagerAdapterConfig) {}

  // Waits before the next attempt, until the signal aborts; always true, so it can sit in the loop condition
  private async waitBeforeRetry(error: unknown, attempt: number, signal?: AbortSignal): Promise<boolean> {
    await waitForRetry(retryDelayMs(error, attempt, this.config.retryDelay ?? DEFAULT_RETRY_DELAY_MS), signal);
    return true;
  }

  async call(
    llmRequest: Strategy.LLM.LLMRequest<any>,
    options?: Strategy.LLM.CallOptions
  ): Promise<Strategy.LLM.LlmResponse<any>> {
    const signal = options?.signal;
    let attempts = 0;
    let lastError: unknown;
    do {
      try {
        const result = await axios.post<Strategy.LLM.LlmResponse<any>>(this.config.llmCallManagerUrl, llmRequest, {
          signal
        });
        return result.data;
      } catch (error) {
        // An aborted call is not retried, and neither is one that cannot succeed on a new attempt (400, 401, 404)
        if (signal?.aborted || !isRetryableError(error)) throw error;
        log.error('call to loft-llm-call-manager-service failed', error);
        lastError = error;
      }
    } while (++attempts < this.config.retryAttempts && (await this.waitBeforeRetry(lastError, attempts, signal)));

    throw new Error(`CallManager doesn't work`, { cause: lastError });
  }

  async streamCall(llmRequest: Strategy.LLM.LLMRequest<any>): Promise<AxiosResponse<any, any>> {
    let attempts = 0;
    let lastError: unknown;
    do {
      try {
        const res = await axios({
          method: 'post',
          url: this.config.llmCallManagerUrl,
          responseType: 'stream',
          headers: {
            'Content-Type': 'application/json'
          },
          data: llmRequest
        });

        return res.data;
      } catch (error) {
        if (!isRetryableError(error)) throw error;
        log.error('streamCall to loft-llm-call-manager-service failed', error);
        lastError = error;
      }
    } while (++attempts < this.config.retryAttempts && (await this.waitBeforeRetry(lastError, attempts)));

    throw new Error(`stream call doesn't work`, { cause: lastError });
  }

  async getHealthCheckStatus(): Promise<boolean> {
    await axios.get(this.config.llmCallManagerUrl);
    return true;
  }
}

export class NativeCallManagerStrategy implements Strategy.CallManager {
  constructor(private readonly generateCallManager: Strategy.GenerateCallManager<any, any>) {}

  async call(
    llmRequest: Strategy.LLM.LLMRequest<any>,
    options?: Strategy.LLM.CallOptions
  ): Promise<Strategy.LLM.LlmResponse<any>> {
    const llmBody = await this.generateCallManager.addHighPriorityTask(llmRequest, options);
    return { llmBody } as Strategy.LLM.LlmResponse<any>;
  }

  async streamCall(llmRequest: Strategy.LLM.LLMRequest<any>) {
    const result = await this.generateCallManager.addHighPriorityTask(llmRequest);
    return result;
  }

  async getHealthCheckStatus(): Promise<boolean> {
    return true;
  }

  stop(): void {
    this.generateCallManager.stop?.();
  }
}
