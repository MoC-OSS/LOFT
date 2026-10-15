import { Agent } from '@moc-global/loft-definitions';

import { NodeRetryExhaustedError } from '../errors';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryResult<T> {
  result: T;
  retryCount: number;
}

/** A cancelled run is not retried, nor is an error the policy's retryOn rejects. */
function isRetryable(error: Error, policy: Agent.RetryPolicy, signal?: AbortSignal): boolean {
  if (signal?.aborted) {
    return false;
  }
  return !policy.retryOn || policy.retryOn(error);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: Agent.RetryPolicy,
  nodeName: string,
  onRetry?: (attempt: number, error: Error, delayMs: number) => void,
  signal?: AbortSignal
): Promise<RetryResult<T>> {
  const backoff = policy.backoffMultiplier ?? 1;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, retryCount: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt >= policy.maxRetries) {
        break;
      }

      if (!isRetryable(lastError, policy, signal)) {
        throw lastError;
      }

      const waitMs = policy.delayMs * Math.pow(backoff, attempt);
      onRetry?.(attempt, lastError, waitMs);
      await delay(waitMs);
    }
  }

  throw new NodeRetryExhaustedError(nodeName, policy.maxRetries, lastError!);
}
