export interface LlmTokenRateLimiter {
  awaitBeforeCall: (requestedTokens?: number) => Promise<void>;
  /**
   * Waits until `tokens` tokens and one request are available, then takes both in the same synchronous step, so
   * two calls running at the same time cannot both pass on one budget. Checks again after every wait. A limiter
   * without it is checked with `awaitBeforeCall` and charged with `setUsedTokens` and `setUsedRequest`.
   *
   * When `signal` aborts while it waits, it rejects at once with the signal's reason and takes nothing.
   */
  acquire?(tokens: number, signal?: AbortSignal): Promise<void>;
  /** Takes `usedTokens` from the budget; a negative value refunds. */
  setUsedTokens: (usedTokens: number) => void;
  setUsedRequest: () => void;
  /** Stops background timers; called on shutdown. */
  stop?: () => void;
}

export interface LlmTokenRateLimiterConfig {
  newTokensPerSecond: number;
  newRequestsPerSecond: number;
  maxTokens: number;
  maxRequests: number;
  maxAwaitSeconds: number;
}
