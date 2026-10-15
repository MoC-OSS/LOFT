export interface LlmTokenRateLimiter {
  awaitBeforeCall: (requestedTokens?: number) => Promise<void>;
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
