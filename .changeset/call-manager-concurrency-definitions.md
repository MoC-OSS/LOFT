---
'@moc-global/loft-definitions': minor
---

The rate limiter interface, `Strategy.LLM.LlmTokenRateLimiter`, gains an optional `acquire(tokens, signal?)`, which waits until the tokens and one request are available and takes both in one synchronous step, checking again after every wait; when `signal` aborts during a wait, it rejects at once and takes nothing. A rate limiter without `acquire` is still used through `awaitBeforeCall`, `setUsedTokens` and `setUsedRequest`. The interface now documents that `setUsedTokens` takes a negative value to refund tokens.
