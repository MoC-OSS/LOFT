---
'@moc-global/loft': patch
'@moc-global/loft-definitions': patch
'@moc-global/loft-anthropic-strategy': patch
'@moc-global/loft-gemini-strategy': patch
'@moc-global/loft-llm-call-manager': patch
'@moc-global/loft-chat-history-pg-repository': patch
'@moc-global/loft-session-pg-repository': patch
---

Stop background timers on shutdown, keep chat content out of default logs, and fix `to-current-lib-version`.

- The migration command `to-current-lib-version` migrates to the newest migration at or below the library version (library 1.2.5 runs migrations up to 1.2.0). It used to fail because no migration is named after the library version.
- The refill timer of `LlmTokenRateLimiter` no longer keeps the process alive. `LlmTokenRateLimiter` and `ExponentialBackoffPoller` have a `stop()`; the poller still keeps a queue worker alive until it is stopped. `LOFT.shutdown()` calls the new optional `stop()` of each registered LLM strategy, which stops the rate limiter of its call manager and the queue poller of `GenerateWithQueueManager`. A worker that runs `GenerateWithQueueManager` without LOFT calls its `stop()` to exit.
- Tool arguments, tool results and user messages are no longer logged at INFO, WARN or ERROR; they are logged at DEBUG. `PinoLoggerStrategy` drops the request (body and headers) of HTTP client errors and redacts credential fields and headers. The configuration reference lists what each log level contains.
- A tool error that is not a string reaches the model as JSON or as the error's message, instead of `[object Object]`.
- The Postgres health checks bind the schema name as a query parameter instead of putting it in the SQL text.
- The compiled unit tests are no longer built into `lib` of the Anthropic, Gemini, LLM call manager and chat history packages.
