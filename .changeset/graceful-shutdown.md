---
'@moc-global/loft': minor
---

Graceful shutdown lets the requests in flight finish and can be bounded.

- A request that is running when `shutdown()` starts now finishes. Before, the steps it started after that point (the LLM call of `generate()`) were rejected with `ShutdownError`, so the request failed.
- `ChatConfig.shutdownTimeout` (milliseconds) limits how long `shutdown()` waits for the requests in flight; it then logs a warning and returns. Without it, `shutdown()` waits as long as they run, as before. The wait no longer polls every 100 ms.
- `LOFT.shutdown()` shuts the tracer down as its last step. `LoftConstructor.gracefulShutdown()`, which did that, is deprecated; calling it after `shutdown()` still works.
