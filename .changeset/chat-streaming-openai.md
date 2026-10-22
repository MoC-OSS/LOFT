---
'@moc-global/loft-openai-strategy': minor
---

`OpenAiCallStrategy` and `AzureOpenAiCallStrategy` stream inside `generate()` when LOFT passes an `onEvent` sink in the call options. The request is sent with `stream: true`, the first choice's text and refusal reach the sink as they arrive, and `generate()` resolves with the same `ChatCompletion` the request returns without streaming, so `formatToUnifiedLLMResponse` and `extractUsedTokens` work unchanged. Tool-call arguments and the text of other choices are never sent to the sink; their chunks only report activity. A finish on the content filter is returned, not thrown, and an error in the middle of the stream rejects with the SDK's error. An abort of the call's signal rejects with the SDK's `APIUserAbortError`, as it does without streaming, even when the stream had already finished all choices. A stream that ends before every choice finished, between events or inside one, rejects with the SDK's retryable `APIConnectionError` (when it ends inside an event, with the SDK's parse error as its `cause`); once every choice has finished, a stream cut short in the `[DONE]` line or before the usage chunk resolves with what arrived; when the usage chunk was lost, token accounting falls back to 500 tokens. The provider logs a failed streamed call with the error's class, status, `type` and `code` only: the provider's own failure log never includes the error message. The call manager and the chat still log the error as before. Requests with a `json_schema` response format or a `strict` tool are not streamed, because the SDK can return a different result for them; they take the usual path, and LOFT sends the reply text once the call returns. Without `onEvent` nothing changes.

Both call strategies take an optional, experimental last constructor argument, `OpenAiStrategyOptions`:

- `streaming` (default `true`): `false` never streams, even when LOFT passes `onEvent`.
- `streamUsage` (default `true`): asks the API to send the usage at the end of the stream (`stream_options.include_usage`). With `false` the usage of a streamed call is unknown, and token accounting falls back to 500 tokens, as it does today for a response without usage.
- `clientOptions`: `{ timeout?, maxRetries? }`, passed to the `OpenAI` or `AzureOpenAI` client.

`generateStream` and `extractContentFromChunk` of both call strategies, and the `generateStream` method of `OpenAiLoftStrategy` and `AzureOpenAiLoftStrategy` are deprecated, with nothing removed now. Use `chat.generate({ onEvent })` instead. They are removed in the next major release.

The logprobs of a streamed call are added to one list per choice as they arrive, instead of copying the whole list for every chunk, so a long stream with `logprobs` takes linear time. The resulting `ChatCompletion` is unchanged.
