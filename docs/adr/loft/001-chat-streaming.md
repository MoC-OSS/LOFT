# ADR-001: Chat Streaming — Per-Call Events on `generate()`

## Status

Proposed

## Context

LOFT applications want to show an LLM answer while it is being written, not 5–30 seconds later when the whole tool loop has finished. Before this change, `loft.chat.generate()` returned only at the end. The repository had stream building blocks (`LLMApi.generateStream`, `CallManager.streamCall`, `UnifiedLLMStream`, `GenerateWithStreamManager`, `DI_TYPES.StreamLoft`), but no public API reached them, and they did not work end to end.

So applications streamed below LOFT. A production consumer did it with a custom `Strategy.CallManager` that streamed from OpenAI and handed LOFT the final completion. To make that work it had to:

- look up an emitter in a process-wide registry keyed by session id, from inside the call manager and from its tools;
- copy the call manager's rate-limit logic;
- bypass the per-model queue to get parallel calls;
- read tool progress out of tracer span names.

Every application would have to rebuild this, and every LOFT upgrade could quietly break it.

Requirements:

- A consumer receives the events of one `generate()` call: text deltas, step boundaries, tool activity, data sent by tools, and one final event.
- Everything is optional. Without the new options, `generate()` behaves as before, and mixed package versions keep working.
- The tool loop, middleware, Focus, tracing, the `GenerateResult` and `save()` stay as they are.
- Safe by default: error events never carry provider or internal text; tool outputs are never sent, and reasoning and tool arguments only when the caller asks; text is not streamed past middleware that may change it unless the caller asks.
- A slow client must not hold a model's queue slot, and nothing is retried after output reached the client.

The existing stream symbols were not marked `@experimental`, so the [versioning policy](../../contributing/releasing.md#versioning-and-deprecation-policy) covers them: they can be deprecated in a minor release and removed only in a major one.

## Decision

Streaming is an optional, experimental callback on the existing `chat.generate()`. It travels down the path the abort signal already takes, and each provider streams inside the `generate()` call it already makes, returning the same final response.

```
chat.generate({ onEvent, streamOptions })                  BaseLoftChat.generate
  ├─ session, validation, input middleware, Focus, ALREADY_GENERATED     → no events
  └─ callAndHandle
       ├─ BeforeGenerate middleware                                       → still no events
       ├─ resolve the LLM and the stream options → start
       └─ LlmManager.generate(…, { signal, events })             the tool loop
            per LLM call: step-start, status queued
              strategy.generate(request, { signal, onEvent: sink for this step })
                └ CallManager → GenerateCallManager → LLMApi.generate
                    (request-start → status generating; text deltas; the same native response)
              text sent once after the call if the provider streamed none
              tools: tool-call, data…, tool-result
              step-finish
       └─ AfterGenerate middleware
  └─ Focus post-processing → finish(final text), then the tracer flush   or error | abort
```

### 1. Where it is built and released

The feature is built in this repository and released to the existing `@moc-global` npm packages, so existing applications get it through a minor upgrade.

### 2. An optional callback on `generate()`, not a second API

```typescript
// packages/loft-definitions/src/shared/components/Chat.ts
export interface GenerateOptions {
  // …
  /** @experimental Receives this call's events. Called synchronously and not awaited; an exception it throws, or a promise it returns that rejects, is contained and logged. */
  onEvent?: (event: ChatStreamEvent) => void;
  /** @experimental Per-call override of the library's streaming defaults; ignored without onEvent. */
  streamOptions?: StreamOptions;
}
```

`ChatConfig.streaming` sets the defaults, and a call's `streamOptions` are merged over them key by key. The events (`ChatStreamEvent` in `packages/loft-definitions/src/shared/components/ChatStreamEvent.ts`) are `start`, `status`, `step-start`, `text-delta`, `reasoning-delta`, `tool-call`, `data`, `tool-result`, `step-finish`, and exactly one final `finish`, `error` or `abort`. Each carries `seq` and `runId`. A failure before `start` (up to and including the BeforeGenerate middleware, or an unknown LLM name) sends nothing, so an HTTP handler can still answer it with a status code. `finish.text` is the final reply after all middleware, and is the text to show. `step-finish` and `finish` carry a normalized `reason` (`stop`, `length`, `content-filter`, `tool-calls`, `error`, `other`) next to the provider's own `finishReason`; `abort` carries `reason: 'timeout' | 'cancelled'`; and `error` can carry `retryAfterMs` for a rate-limited call. `finish` is sent before the tracer flush, and a flush that fails after a successful generation is logged without failing the call.

All new streaming symbols are `@experimental`. A pull-style `chat.stream()` that returns an async iterable can be added later as a wrapper over the same events, not as a replacement.

### 3. `generate()` stays; providers stream inside it

`chat.generate()` is not deprecated, and providers get no new method. A call strategy streams inside `LLMApi.generate(request, options)` when `options.onEvent` is set, and resolves with a value of the same type and meaning as without it, so `formatToUnifiedLLMResponse`, `extractUsedTokens` and the tool loop work unchanged:

```typescript
// packages/loft-definitions/src/strategies/llm/LlmCall.ts
export interface CallOptions {
  signal?: AbortSignal;
  /** @experimental Set by LOFT to stream this call. Providers that cannot stream ignore it. Never throws. */
  onEvent?: LlmStreamSink;
}
```

The OpenAI and Azure OpenAI, Anthropic and Gemini strategies stream, and each takes a `streaming: false` option. OpenAI/Azure and Gemini build the native response with a small accumulator of their own; Anthropic uses the SDK's `messages.stream()` and its `finalMessage()`, which returns the same `Message` as the non-streamed call. Requests whose streamed result could differ (OpenAI `json_schema` and `strict` tools, and Gemini requests with a `candidateCount` above 1, which Vertex AI rejects streamed) are not streamed. A provider that ignores `onEvent`, an older provider package, a custom call manager or `HttpCallManagerStrategy` falls back: the events still arrive, and each step's text is sent once after the call. Provider events are small and never carry tool arguments, reasoning signatures, raw chunks or the text of other choices.

### 4. Guardrails fail closed

When middleware that may change the reply text is registered (an AfterGenerate middleware, or a strategy's own middleware) and the caller chose no text policy, text is held back until that middleware has run and is sent once before `finish`. LOFT logs a one-time warning that names the middleware, and `start.textPolicy` reports the policy. Middleware that only reads the reply is registered with `{ transformsOutput: false }`. A strategy that cannot tell whether it has such middleware counts as having it.

### 5. The call manager foundations first

Before any event was added, the call manager and the tool path were made ready for it, each as its own release-worthy change:

- `GenerateConfig.concurrency` (default 1), per model, replacing the need to bypass the queue;
- race-free token reservation: the optional `LlmTokenRateLimiter.acquire(tokens, signal?)` takes the tokens and a request in one synchronous step, the reservation is settled to the provider's count afterwards, a call that failed before the provider sent anything gets its tokens back, and `reserveTokens: false` restores the old accounting;
- one helper for the five tool paths of `LlmManager`, pinned by characterization tests;
- a tool handler context with the abort `signal` and an `emit(name, data)` that now sends `data` events.

On top of these, streamed calls send `request-start` before each attempt, are never retried once an event reached the consumer, and have an idle timeout (`streamIdleTimeoutMs`, default 60 s, started by the first text, reasoning or activity) and a first-event timeout (`streamFirstEventTimeoutMs`, default 10 minutes like the SDKs' request timeout, because reasoning models can be silent for minutes; a usage report does not start the idle timer or end the first-event wait, so silent reasoning is bounded by this timeout and the caller's signal, since the SDKs' request timeout covers only the wait for the response headers).

### 6. Abort and error save nothing

An aborted or failed generation saves nothing, and the documentation says so, including that tools which already finished are not saved, so a tool with side effects can run again on the next turn. An aborted call is still billed by the provider, and `finish.usage` covers only the provider calls that completed. `finish` means the generation ended, not that the reply was saved; the caller still calls `result.messages.save()`. `shutdown()` is unchanged: it waits and neither aborts nor emits.

### 7. The old stream API is deprecated in the release that replaces it

`LLMApi.generateStream` and `extractContentFromChunk`, `CallManager.streamCall`, `LoftLLM.generateStream`, `UnifiedLLMStream`, `UnifiedLLMChunkResponse`, `GenerateWithStreamManager`, `Interface.LlmManager.generateStream`, `GeminiStream`, the `generateStream` methods of every strategy and `Chat.Status.SUCCESS_STREAM` get `@deprecated` in the release that ships `onEvent`, in every package that exports them. They stay required members of their interfaces and are removed in the next major release.

### 8. Raising a peer range's minimum is not a breaking change

The release policy was reworded: raising a peer dependency's minimum within the same major (which publishing does on its own, by rewriting `workspace:^` to the current version) may ship in any release type. Dropping a major from a peer range stays a major change. Without this, every release that needs the new definitions would have to be a major.

## Alternatives Considered

### A separate streaming API (`chat.stream()` first)
- A second generation method, returning an async iterable, that consumers would migrate to.
- Rejected for the first release: it would duplicate the pre-flight, middleware and save paths, and make streaming a migration instead of an option. The callback is the smallest change that reaches every layer; an iterable can wrap it later.

### A separate provider method (`generateStream`)
- Keep a streaming method next to `generate()` on every provider and call manager.
- Rejected: two code paths per provider drift apart, and the tool loop, token accounting and retries would need a streaming twin. Streaming inside `generate()` keeps one path, as LangChain's chat models do when a streaming handler is attached.

### SDK stream helpers for OpenAI
- Use the OpenAI SDK's stream helper to build the final completion.
- Rejected: its behaviour differs between SDK majors, it parses `json_schema` output and throws on some finishes in the middle of the stream, and its events carry no choice index. LOFT's own accumulator returns exactly what the non-streamed call returns. Anthropic's helper is used, because its `finalMessage()` is the same `Message` the non-streamed call returns on the SDK versions LOFT tests.

### Awaited callbacks
- Await `onEvent`, so a consumer can apply backpressure (AI SDK `onChunk`, Mastra's writer).
- Rejected: a slow client would hold the model's queue slot. The callback is synchronous; the transport bounds its own buffer.

### Raw provider events
- Pass the provider's own events to the consumer (OpenAI Agents).
- Rejected: they carry tool arguments, reasoning signatures and other private content, and tie consumers to one provider.

### Retrying after output was sent
- Retry a failed step even after text reached the client.
- Rejected: the client would see the text twice, or a different answer spliced onto the first.

### Guardrails in parallel with the output
- Stream the text and run the output checks at the same time, as OpenAI Agents can do for input guardrails (`runInParallel`).
- Rejected: the client sees text before the checks finish. Holding text back is the safe default; callers can opt into `textPolicy: 'all'`.

### Smoothing in LOFT
- Even out the text delta rate in the library.
- Rejected: it belongs in the UI or the transport.

## Consequences

### Positive
- Streaming is one option on the call applications already make; the result, `save()`, middleware, Focus and tracing are unchanged.
- The production consumer's workaround becomes unnecessary: no custom call manager, no emitter registry, no copied rate-limit logic, no span-name parsing. Tool progress travels as `data` events, and its own wire format stays behind a small adapter.
- One provider path serves both modes, so every provider fix applies to streamed and non-streamed calls alike.
- Safe defaults: fixed error messages per code, no tool output ever and no tool arguments unless asked, text held back behind output middleware, and the streaming code logs no payloads (no text, tool arguments or outputs, `data` payloads or raw chunks). LOFT's older error logs are not covered by this and may include the provider's error text.
- Calls running at the same time can no longer overspend a rate limit, and per-model concurrency is configurable.
- The observe-only mode (`streamOptions.enabled: false`) doubles as a switch to turn provider streaming off without touching callers.

### Negative
- The token accounting changed for every call: tokens are reserved before the call. `reserveTokens: false` restores the old behaviour, and a subclass that overrides `makeGenerateRequest` must pass the reservation on.
- Text held back by default when output middleware is registered surprises callers who expected deltas; the warning and `start.textPolicy` make it visible.
- The callback is synchronous and not awaited, even when it is `async`, so each transport must bound its own buffer and choose a disconnect policy.
- A provider can stop a reply after text was shown (content filters), and `finish.text` can differ from the deltas; clients must render `finish.text` and check `reason`.
- The deprecated stream symbols stay required members of public interfaces until the next major.
- Every event shape is experimental until the API is declared stable.

### Later work
- `chat.stream()` as an async iterable with a bounded buffer and a `slow_consumer` error code; `data` events from middleware; a NestJS example; `onEvent` leaves experimental.
- Events from `loft-agents` nodes, with a `step-reset` event for node retries; a transport package if the examples show one is needed.
- Removing the deprecated stream API in the next major.

## References

- `packages/loft-definitions/src/shared/components/ChatStreamEvent.ts` — the chat events and `StreamOptions`
- `packages/loft-definitions/src/strategies/llm/LlmStreamEvent.ts` — the provider events and the sink
- `packages/loft/src/workflows/chat/streaming/` — the per-call emitter, option resolution and error codes
- `packages/loft/src/workflows/chat/BaseLoftChat.ts`, `packages/loft/src/managers/LlmManager.ts` — where the events are produced
- `packages/loft-llm-call-manager/src/GenerateManager.ts` — reservation, delivery-aware retries and stream timeouts
- `packages/loft-openai-strategy/src/streaming/`, `packages/loft-anthropic-strategy/src/streaming/`, `packages/loft-gemini-strategy/src/gemini/streaming/` — the provider streams (and the OpenAI and Gemini accumulators)
- `examples/express-streaming/` — an SSE transport with a disconnect policy
- [Streaming guide](../../guides/streaming.md)
- Prior art:
  - LangChain: one code path for invoke and stream ([`chat_models.ts`](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-core/src/language_models/chat_models.ts)); usage in the stream by default and a per-model switch to turn streaming off ([ChatOpenAI](https://docs.langchain.com/oss/javascript/integrations/chat/openai))
  - LangGraph: sequence numbers and a namespace path on events ([`stream/types.ts`](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/stream/types.ts), [streaming](https://docs.langchain.com/oss/javascript/langgraph/streaming)); consumers ignore unknown event types ([event streaming](https://docs.langchain.com/oss/javascript/langgraph/event-streaming))
  - AI SDK: step events, total usage and a chunk timeout ([`streamText`](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)); errors masked by default ([`to-ui-message-chunk.ts`](https://github.com/vercel/ai/blob/main/packages/ai/src/ui-message-stream/to-ui-message-chunk.ts)); `reset-step` ([stream protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)); finishing a generation after a disconnect ([message persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence)); transient data parts ([streaming data](https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data))
  - Mastra: tool output tagged with its call ([`ToolStream`](https://github.com/mastra-ai/mastra/blob/main/packages/core/src/tools/stream.ts))
  - OpenAI Agents JS: a result that always settles ([streaming](https://openai.github.io/openai-agents-js/guides/streaming/))
