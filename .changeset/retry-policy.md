---
'@moc-global/loft-definitions': minor
'@moc-global/loft-llm-call-manager': patch
---

The call managers retry only what can succeed on a new attempt, with backoff.

- `GenerateCallManager` and `HttpCallManagerStrategy` retry 408, 429 and 5xx responses and network failures, and no longer retry a 400, 401 or 404, or any other error.
- The wait doubles with each attempt, from `retryDelay`, between half and all of it at random (jitter), at most 60 s. A `Retry-After` (or `retry-after-ms`) header from the provider sets the wait instead.
- `HttpCallManagerStrategy` waited nothing between attempts; it now takes an optional `retryDelay` (default 500 ms). `call()` and `streamCall()` throw the axios error itself for a response that is not retried (a 400, 401 or 404, say), instead of `Error("CallManager doesn't work")`; that error is still thrown, with the last error as its `cause`, when the retries run out.
- `GenerateWithStreamManager` follows the same policy instead of retrying every error after a fixed delay.
- The connection and timeout errors of the OpenAI and Anthropic SDKs are retried; they are recognised by their class, as their `name` is `Error`.
- Aborting the call's `signal` ends the wait before a retry. An invalid `retryDelay` (NaN, say) counts as 0 instead of replacing the provider error.
- `@moc-global/loft-definitions` exports the policy: `isRetryableError()`, `retryDelayMs()`, `retryAfterMs()`, `errorStatus()` and `waitForRetry()`.
