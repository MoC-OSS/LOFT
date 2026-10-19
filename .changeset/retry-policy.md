---
'@moc-global/loft-definitions': minor
'@moc-global/loft-llm-call-manager': patch
---

The call managers retry only what can succeed on a new attempt, with backoff.

- `GenerateCallManager` and `HttpCallManagerStrategy` retry 408, 429 and 5xx responses and network failures, and no longer retry a 400, 401 or 404, or any other error.
- The wait doubles with each attempt, from `retryDelay`, between half and all of it at random (jitter), at most 60 s. A `Retry-After` (or `retry-after-ms`) header from the provider sets the wait instead.
- `HttpCallManagerStrategy` waited nothing between attempts; it now takes an optional `retryDelay` (default 500 ms).
- `@moc-global/loft-definitions` exports the policy: `isRetryableError()`, `retryDelayMs()`, `retryAfterMs()` and `errorStatus()`.
