import { isRetryableError, Logger, retryDelayMs, Strategy, waitForRetry } from '@moc-global/loft-definitions';
import PQueue from 'p-queue';

import { TooManyHighPriorityTasksError } from './errors';
import { GenerateConfig } from './types';

const log = new Logger('LlmCallManager');

/**
 * The part of p-queue the call managers use. p-queue publishes its types only through `exports`, so declaring
 * the queue type here keeps the published types working under `moduleResolution: node`.
 */
export interface TaskQueue {
  readonly size: number;
  sizeBy(options: { priority?: number }): number;
  add<T>(task: () => Promise<T>, options?: { priority?: number; signal?: AbortSignal }): Promise<T>;
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

    // A task aborted while it waits leaves the queue, so it no longer counts toward highPriorityTasksLimit. The
    // queue gets its own signal that follows the caller's only until the task starts: p-queue frees the slot of a
    // running task whose signal aborts, and the next task would then run while the aborted one still ends.
    const { signal } = options ?? {};
    const waiting = new AbortController();
    const abortWaiting = () => waiting.abort(signal?.reason);
    if (signal?.aborted) abortWaiting();
    signal?.addEventListener('abort', abortWaiting, { once: true });

    try {
      const llmResponse = await this.taskPQueue.add(
        () => {
          signal?.removeEventListener('abort', abortWaiting);
          return this.taskPQueueHandler(llmRequest.llmBody, options);
        },
        { priority: llmRequest.priority, signal: waiting.signal }
      );
      return llmResponse as T_LLM_Res;
    } catch (error) {
      log.error('addHighPriorityTask failed', error);
      throw error;
    } finally {
      signal?.removeEventListener('abort', abortWaiting);
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
        // An aborted call is not retried, and neither is one that cannot succeed on a new attempt (400, 401, 404)
        if (options?.signal?.aborted || !isRetryableError(error)) throw error;
        log.error('makeGenerateRequest attempt failed', error);
        lastError = error;
        attempt++;
        if (attempt < this.config.retryAttemptsLimit) {
          // An abort ends the wait: a Retry-After of up to 60 s holds the queue slot meanwhile
          await waitForRetry(retryDelayMs(error, attempt, this.config.retryDelay), options?.signal);
        }
      }
    } while (attempt < this.config.retryAttemptsLimit);

    log.error('makeGenerateRequest failed after retries');
    throw lastError;
  }

  async taskPQueueHandler(llmRequest: T_LLM_Req, options?: Strategy.LLM.CallOptions) {
    const totalMessage = this.llmStrategy.reduceMessages(llmRequest);
    const predictedTokens = this.llmStrategy.llmTokenizer.calculateTokensFromString(totalMessage);
    await this.llmStrategy.tokenRateLimiter.awaitBeforeCall(predictedTokens);
    // The rate limiter does not watch the signal, so a call aborted during its wait ends here
    options?.signal?.throwIfAborted();
    const llmResponse = await this.makeGenerateRequest(llmRequest, options);
    return llmResponse;
  }
}
