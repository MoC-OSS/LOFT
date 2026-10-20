---
'@moc-global/loft': minor
---

Graceful shutdown lets the requests in flight finish and can be bounded.

- A request that is running when `shutdown()` starts now finishes. Before, the steps it started after that point (the LLM call of `generate()`) were rejected with `ShutdownError`, so the request failed.
- `ChatConfig.shutdownTimeout` (milliseconds) limits how long `shutdown()` waits for the requests in flight; it then logs a warning and returns. Without it, `shutdown()` waits as long as they run, as before. A negative or non-finite value is rejected when the chat is created. The wait no longer polls every 100 ms.
- `LOFT.shutdown()` shuts the tracer down as its last step. `LoftConstructor.gracefulShutdown()`, which did that, is deprecated; calling it after `shutdown()` still works.
- A call started from a finished operation without being awaited is rejected with `ShutdownError` after `shutdown()`, like any new call.
- When stopping the LLM strategies throws, `LOFT.shutdown()` logs the error and still shuts the tracer down.
- The manifest error file also holds the cause of a load error, such as the JSON parse error.
