import { Strategy } from '..';

export interface GenerateCallManager<T_LLM_Req, T_LLM_Res> {
  addHighPriorityTask(
    llmRequest: Strategy.LLM.LLMRequest<T_LLM_Req>,
    options?: Strategy.LLM.CallOptions
  ): Promise<T_LLM_Res>;
  getCountOfHighPriorityTaskQueue(): number;
  makeGenerateRequest(llmRequest: T_LLM_Req, options?: Strategy.LLM.CallOptions): Promise<T_LLM_Res>;
  taskPQueueHandler(llmRequest: T_LLM_Req, options?: Strategy.LLM.CallOptions): Promise<T_LLM_Res>;
  /** Stops background timers (rate limiter, queue poller); called on shutdown. */
  stop?(): void;
}

export interface CallManager {
  call(
    llmRequest: Strategy.LLM.LLMRequest<any>,
    options?: Strategy.LLM.CallOptions
  ): Promise<Strategy.LLM.LlmResponse<any>>;
  /**
   * @deprecated Use chat.generate({ onEvent }) instead.
   * Removed in the next major release.
   */
  streamCall(llmRequest: Strategy.LLM.LLMRequest<any>): Promise<any>;
  getHealthCheckStatus(): Promise<boolean>;
  /** Stops background timers; called on shutdown. */
  stop?(): void;
}
