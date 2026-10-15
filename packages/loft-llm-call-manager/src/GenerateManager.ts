import { Logger, Strategy } from '@moc-global/loft-definitions';
import PQueueImport from 'p-queue';

import { TooManyHighPriorityTasksError } from './errors';
import { GenerateConfig } from './types';
import { delay } from './utils';

const log = new Logger('LlmCallManager');

// p-queue 6 is CommonJS and exports the class as `exports.default`. Node's ESM loader hands over the whole
// exports object as the default import, so the class sits one level deeper there.
type PQueue = PQueueImport;
const PQueue: typeof PQueueImport =
  (PQueueImport as unknown as { default?: typeof PQueueImport }).default ?? PQueueImport;

export class GenerateCallManager<T_LLM_Req, T_LLM_Res> implements Strategy.GenerateCallManager<T_LLM_Req, T_LLM_Res> {
  taskPQueue: PQueue;
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
