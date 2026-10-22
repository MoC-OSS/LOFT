---
'@moc-global/loft-definitions': minor
---

Adds the experimental types for streaming a chat reply. `Strategy.LLM.LlmStreamEvent`, `LlmStreamSink` and `StreamUsage` describe what a provider reports while it streams, and `CallOptions.onEvent` lets LOFT pass a sink to a provider. `Chat.ChatStreamEvent`, `ChatStreamEventBase`, `ChatStreamErrorCode` and `StreamOptions` describe the events of a streamed `generate()` call, and `Chat.GenerateOptions` gets the optional `onEvent` and `streamOptions`. Existing code is unaffected.

Middleware can now declare that it does not change the reply text: `registerAfterGenerateMiddleware`, `AbstractLoftLLM.useMiddleware` and `MiddlewareManager.use` take an optional `{ transformsOutput?: boolean }` (default `true`, the current behaviour). `MiddlewareManager` exposes `transformingCount` and `transformingNames`, and `LoftLLM` gets the optional `hasOutputMiddleware()`, which `AbstractLoftLLM` implements.

Adds `StreamIdleTimeoutError`, for a model stream that stays silent for too long. The last parameter of `Interface.LlmManager.generate` is now `Interface.LlmGenerateOptions`, which extends `CallOptions`. Both it and `Chat.GenerationEventSink` are internal and may change in any release.

Deprecated, with nothing removed now: `Strategy.LLM.LLMApi.generateStream` and `extractContentFromChunk`, `Strategy.CallManager.streamCall` (and the `streamCall` methods of the call manager strategies), `Strategy.LLM.LoftLLM.generateStream`, `Strategy.LLM.UnifiedLLMStream`, `Strategy.LLM.UnifiedLLMChunkResponse`, `Interface.LlmManager.generateStream` and `Chat.Status.SUCCESS_STREAM`. Use `chat.generate({ onEvent })` instead. They stay on the interfaces as required members and are removed in the next major release.

`step-finish` and `finish` events carry `reason`, the finish reason normalized across providers (`Chat.ChatFinishReason`: `'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'`, a union that may gain values), beside `finishReason`, which stays the provider's raw value. The `abort` event carries `reason: 'timeout' | 'cancelled'`, and an `error` event with `code: 'rate_limited'` may carry `retryAfterMs`.
