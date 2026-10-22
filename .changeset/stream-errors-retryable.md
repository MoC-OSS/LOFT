---
'@moc-global/loft-definitions': minor
---

`isRetryableError` now also treats an error without an HTTP status as retryable when its `type` or `error.type` is `overloaded_error`, `api_error` (Anthropic) or `server_error` (OpenAI), as the provider errors that arrive in the middle of a stream do. An error with a status is still judged by the status alone.
