export interface CustomCallConfig {
  customCallLimit: number;
  retryDelay: number;
  retryAttemptsLimit: number;
}
export interface GenerateConfig {
  highPriorityTasksLimit: number;
  retryDelay: number;
  retryAttemptsLimit: number;
  /** How many calls of this model run at the same time. An integer of at least 1. Default: 1 */
  concurrency?: number;
  /**
   * Takes the predicted tokens from the rate limiter before the call and settles to the actual usage after it, so
   * calls running at the same time cannot overspend the budget. `false` charges the actual usage after a successful
   * call only. Default: true
   */
  reserveTokens?: boolean;
  /**
   * @experimental
   * For a streamed call (one with `onEvent`): how long an attempt may stay silent between two provider events before
   * it is aborted with `StreamIdleTimeoutError`, in milliseconds. It starts at the provider's first output (text,
   * reasoning or other activity; a usage report does not start it), and after that every provider event restarts it.
   * The wait before the first output, such as a model thinking without sending its thoughts, is bounded by
   * `streamFirstEventTimeoutMs` instead. `0` disables it. An integer from 0 to 2147483647, or the constructor throws a
   * `RangeError`. Default: 60000
   */
  streamIdleTimeoutMs?: number;
  /**
   * @experimental
   * For a streamed call (one with `onEvent`): how long an attempt may wait for the provider's first output (text,
   * reasoning or other activity; a usage report does not end the wait) before it is aborted with
   * `StreamIdleTimeoutError`, in milliseconds. A running stream is bounded only by this timeout until its first output,
   * then by `streamIdleTimeoutMs`, and by the caller's signal: the SDKs' request timeout covers only the wait for the
   * response headers. It also bounds calls the provider answers without streaming (a provider that ignores `onEvent`,
   * or a request it does not stream, such as one with a JSON schema or strict tools), which send no event until the
   * whole answer arrives, so it must stay above your longest non-streamed response and your longest silent reasoning.
   * `0` turns it off. An integer from 0 to 2147483647, or the constructor throws a `RangeError`. Default: 600000 (10
   * minutes, the SDKs' request timeout)
   */
  streamFirstEventTimeoutMs?: number;
}

export interface GenerateWithQueueConfig extends GenerateConfig {
  minPollerInterval: number;
  maxPollerInterval: number;
  pollerTimeCoefficient: number;
  /**
   * How many times a task that waited too long for the rate limiter goes back to the incoming queue. After that it
   * goes to the dead-letter queue, or as an error message to the outgoing queue. Default: 10
   */
  maxRequeueAttempts?: number;
}
