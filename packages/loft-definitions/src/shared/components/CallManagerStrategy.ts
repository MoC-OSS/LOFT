import axios, { AxiosResponse } from 'axios';

import * as Strategy from '../../strategies';
import { Logger } from './Logger';

const log = new Logger('CallManagerStrategy');

export interface CallManagerAdapterConfig {
  llmCallManagerUrl: string;
  retryAttempts: number;
}

export class HttpCallManagerStrategy implements Strategy.CallManager {
  constructor(private readonly config: CallManagerAdapterConfig) {}

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
        // An aborted call is not retried
        if (signal?.aborted) throw error;
        log.error('call to loft-llm-call-manager-service failed', error);
        lastError = error;
      }
    } while (++attempts < this.config.retryAttempts);

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
        log.error('streamCall to loft-llm-call-manager-service failed', error);
        lastError = error;
      }
    } while (++attempts < this.config.retryAttempts);

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
