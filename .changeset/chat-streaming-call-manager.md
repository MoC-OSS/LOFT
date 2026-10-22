---
'@moc-global/loft-llm-call-manager': minor
---

`GenerateCallManager` (and so `GenerateWithQueueManager`) supports streamed calls. When the call options carry an `onEvent` sink, every attempt first sends `{ type: 'request-start' }` to it, right before the provider call, and the provider gets a wrapped sink and a signal that combines the caller's signal with one of the attempt's own. These parts are experimental:

- An attempt is not retried once one of its events reached the consumer (the sink returned `true`), because a new attempt would repeat that output. While nothing was delivered, retries work as before.
- `streamIdleTimeoutMs` (default 60 000, `0` disables) aborts an attempt that stays silent for that long between two provider events. It starts at the provider's first output (a text, reasoning or activity event), and after that every provider event restarts it. The call then rejects with `StreamIdleTimeoutError` from `@moc-global/loft-definitions`, which is retried while nothing was delivered. If the caller aborted, the call rejects with the abort error instead. A usage report does not start the timer, so a model that thinks without streaming its thoughts (Anthropic sends its first usage as soon as the message starts) is not cut off; that silence is bounded by `streamFirstEventTimeoutMs`.
- `streamFirstEventTimeoutMs` (default 600 000, 10 minutes like the SDKs' request timeout; `0` turns it off) does the same for the wait between `request-start` and the provider's first output; a usage report does not end that wait. A usage report still counts as a provider event for the token reservation. A running stream is bounded only by this timeout until its first output, then by `streamIdleTimeoutMs`, and by the caller's signal: the SDKs' request timeout covers only the wait for the response headers. It also bounds calls the provider answers without streaming (a provider that ignores `onEvent`, or a request it does not stream, such as one with a JSON schema or strict tools), which send no event until the whole answer arrives, so keep it above your longest non-streamed response and your longest silent reasoning.
- Both timeouts must be integers from 0 to 2147483647, or the constructor throws a `RangeError`.
- Neither timer runs while a call waits to retry or after it ended, and neither keeps the process alive.
- Events the provider sends after an attempt was aborted (by a timeout or by the caller) are not passed on.
- A sink that throws counts as not delivered and does not stop the provider's stream. Only the event type is logged.
- With a token reservation, a failed streamed call gives its tokens back only when the provider sent no event in any of its attempts; once the provider sent an event, the reservation is kept, as for a cancelled call.
- A streamed attempt ends at its timeout, or right after the caller aborts, even when the provider ignores the abort, so it does not hold its queue slot; whatever the provider returns or throws after that is dropped. A provider that stops on the abort rejects with its own abort error, as before; one that ignores it ends with the signal's `reason`.

`GenerateWithQueueManager` passes both timeouts through.

Without `onEvent` nothing changes: no `request-start`, no wrapped sink, no timers, and the same retries and token accounting as before.

`GenerateWithStreamManager` is deprecated, with nothing removed now. Use `chat.generate({ onEvent })` instead. It is removed in the next major release.
