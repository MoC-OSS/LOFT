---
'@moc-global/loft-definitions': minor
---

`isRetryableError` now also treats an error without an HTTP status as retryable when its `type` or `error.type` is `overloaded_error`, `api_error` (Anthropic) or `server_error` (OpenAI), as the provider errors that arrive in the middle of a stream do. An error with a status is still judged by the status alone.

New `providerErrorSummary(error)` returns what a log may say about a failed provider request: the error's class name, HTTP `status`, `type` and `code`, never its message or body. The OpenAI, Anthropic and Gemini strategies use it for their streamed-request logs.

New `guardedStreamSink(onEvent, warn)` wraps a provider strategy's stream sink so a sink that throws cannot break the stream; only its first failure is reported, with the event type only. The three strategies use it.
