import { Strategy } from '@moc-global/loft-definitions';

import { LlmCallManagerLongAwaitError } from './errors';
import { delay } from './utils';

export class LlmTokenRateLimiter implements Strategy.LLM.LlmTokenRateLimiter {
  private lastTokenCheck = Date.now();
  private lastRequestCheck = Date.now();
  private availableTokens = 0;
  private availableRequests = 0;
  private readonly refillTimer: NodeJS.Timeout;

  async awaitBeforeCall(requestedTokens?: number) {
    this.recalculateAvailableTokens(); // Add new tokens based on time passed
    if (this.isAvailableRequest(requestedTokens)) return;

    let tokensDelayTime = 0;
    let requestDelayTime = 0;
    if (requestedTokens !== undefined && this.availableTokens < requestedTokens) {
      tokensDelayTime = Math.ceil(
        ((requestedTokens - this.availableTokens) / this.rateLimitConfig.newTokensPerSecond) * 1000
      );
    }
    if (this.availableRequests < 1) {
      requestDelayTime = this.lastRequestCheck + 1000 - Date.now();
    }

    const delayTime = Math.max(requestDelayTime, tokensDelayTime);
    if (delayTime > this.rateLimitConfig.maxAwaitSeconds * 1000) {
      throw new LlmCallManagerLongAwaitError(`Too long await before call`);
    }
    await delay(delayTime);
    this.recalculateAvailableTokens(); // Add new tokens based on time passed
  }

  setUsedTokens(usedTokens: number) {
    this.availableTokens -= usedTokens;
  }
  setUsedRequest() {
    this.availableRequests -= 1;
  }

  private isAvailableRequest(requestedTokens?: number) {
    return this.availableRequests >= 1 && (requestedTokens === undefined || requestedTokens < this.availableTokens);
  }
  private recalculateAvailableTokens() {
    const now = Date.now();
    const timePassed = now - this.lastTokenCheck; // Time passed in milliseconds

    this.lastTokenCheck = now;
    this.availableTokens = Math.min(
      this.rateLimitConfig.maxTokens,
      Math.round(this.availableTokens + Math.floor((timePassed * this.rateLimitConfig.newTokensPerSecond) / 1000))
    );
  }

  private updateAvailableRequests() {
    this.lastRequestCheck = Date.now();
    if (this.availableRequests >= this.rateLimitConfig.maxRequests) {
      return;
    }

    const newRequestsToAdd = Math.min(
      this.rateLimitConfig.newRequestsPerSecond,
      this.rateLimitConfig.maxRequests - this.availableRequests
    );

    if (newRequestsToAdd > 0) this.availableRequests += newRequestsToAdd;
  }

  constructor(private rateLimitConfig: LlmTokenRateLimiterConfig) {
    this.availableRequests = rateLimitConfig.maxRequests;
    this.availableTokens = rateLimitConfig.maxTokens;

    this.refillTimer = setInterval(this.updateAvailableRequests.bind(this), 1000);
    // The refill timer must not keep the process (or a test runner) alive on its own
    this.refillTimer.unref();
  }

  /** Stops the request refill timer. Call it when the application shuts down. */
  stop() {
    clearInterval(this.refillTimer);
  }
}

export interface LlmTokenRateLimiterConfig {
  newTokensPerSecond: number;
  newRequestsPerSecond: number;
  maxTokens: number;
  maxRequests: number;
  maxAwaitSeconds: number;
}
