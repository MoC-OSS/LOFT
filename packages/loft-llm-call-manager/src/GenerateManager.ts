import { Logger, Strategy } from '@moc-global/loft-definitions';
import PQueue from 'p-queue';

import { TooManyHighPriorityTasksError } from './errors';
import { GenerateConfig } from './types';
import { delay } from './utils';

const log = new Logger('LlmCallManager');

/**
 * The part of p-queue the call managers use. p-queue publishes its types only through `exports`, so declaring
 * the queue type here keeps the published types working under `moduleResolution: node`.
 */
export interface TaskQueue {
  readonly size: number;
  sizeBy(options: { priority?: number }): number;
  add<T>(task: () => Promise<T>, options?: { priority?: number }): Promise<T>;
}

export class GenerateCallManager<T_LLM_Req, T_LLM_Res> implements Strategy.GenerateCallManager<T_LLM_Req, T_LLM_Res> {
  taskPQueue: TaskQueue;
  constructor(
    readonly name: string,
    readonly config: GenerateConfig,
    readonly llmStrategy: Strategy.LLM.LLMApi
  ) {
    this.taskPQueue = new PQueue({ concurrency: 1 });
  }

  async addHighPriorityTask(
    llmRequest: Strategy.LLM.LLMRequest<T_LLM_Req>,
    options?: Strategy.LLM.CallOptions
  ): Promise<T_LLM_Res> {
    if (this.getCountOfHighPriorityTaskQueue() >= this.config.highPriorityTasksLimit) {
      throw new TooManyHighPriorityTasksError(`Too many high priority task in ${this.name}`);
    }

    try {
      const llmResponse = await this.taskPQueue.add(this.taskPQueueHandler.bind(this, llmRequest.llmBody, options), {
        priority: llmRequest.priority
      });
      return llmResponse as T_LLM_Res;
    } catch (error) {
      log.error('addHighPriorityTask failed', error);
      throw error;
    }
  }

  stop() {
    this.llmStrategy.tokenRateLimiter.stop?.();
  }

  getCountOfHighPriorityTaskQueue() {
    return this.taskPQueue.size - this.taskPQueue.sizeBy({ priority: 0 });
  }

  async makeGenerateRequest(llmRequest: T_LLM_Req, options?: Strategy.LLM.CallOptions): Promise<T_LLM_Res> {
    let attempt = 0;
    let lastError: unknown;

    do {
      try {
        const llmResponse = await this.llmStrategy.generate<T_LLM_Req, T_LLM_Res>(llmRequest, options);
        this.llmStrategy.tokenRateLimiter.setUsedTokens(this.llmStrategy.extractUsedTokens(llmResponse));
        this.llmStrategy.tokenRateLimiter.setUsedRequest();
        return llmResponse;
      } catch (error) {
        // An aborted call is not retried
        if (options?.signal?.aborted) throw error;
        log.error('makeGenerateRequest attempt failed', error);
        lastError = error;
        attempt++;
        if (attempt < this.config.retryAttemptsLimit) {
          await delay(this.config.retryDelay);
        }
      }
    } while (attempt < this.config.retryAttemptsLimit);

    log.error('makeGenerateRequest failed after retries');
    throw lastError;
  }

  async taskPQueueHandler(llmRequest: T_LLM_Req, options?: Strategy.LLM.CallOptions) {
    // p-queue 6 cannot drop a queued task, so a task aborted while it waited ends here
    options?.signal?.throwIfAborted();
    const totalMessage = this.llmStrategy.reduceMessages(llmRequest);
    const predictedTokens = this.llmStrategy.llmTokenizer.calculateTokensFromString(totalMessage);
    await this.llmStrategy.tokenRateLimiter.awaitBeforeCall(predictedTokens);
    options?.signal?.throwIfAborted();
    const llmResponse = await this.makeGenerateRequest(llmRequest, options);
    return llmResponse;
  }
}
