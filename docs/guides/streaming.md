# Streaming Responses

`loft.chat.generate()` can report its progress while the reply is being written. Pass an `onEvent` callback, and LOFT calls it with each event of the call: the start, the text as the model writes it, the tool calls, and one final event. `generate()` still returns the same result as without the callback, and `result.messages.save()` still stores the turn.

> **Experimental.** `onEvent`, `streamOptions`, `ChatConfig.streaming`, the event types and the tool `emit()` are marked `@experimental`. They may change in a minor release.

The [express-streaming](../../examples/express-streaming/) example serves a streamed reply over Server-Sent Events (SSE), with tool calls, tool progress events, a disconnect policy and route tests that run offline.

## Quick Start

```typescript
import { Chat } from '@moc-global/loft-definitions';

const result = await loft.chat.generate({
  sessionId,
  directMessages,
  signal: controller.signal, // optional: cancels the call
  onEvent: (event: Chat.ChatStreamEvent) => {
    switch (event.type) {
      case 'text-delta':
        process.stdout.write(event.delta);
        break;
      case 'finish':
        console.log('\nfinal text:', event.text); // the text to show
        break;
      case 'error':
        console.error(event.code, event.message);
        break;
      default:
        break; // ignore the rest, and every type you do not know
    }
  }
});

// `finish` does not save anything; store the turn as without streaming
await result.messages.save();
```

Nothing else changes. There is no second API to call, and no provider method to choose: the provider strategies stream inside the call they already make when the call carries an event sink, and return the same final response.

### Before you serve more than one user

- **Size `concurrency`.** A call manager runs one call of its model at a time by default (`concurrency: 1`, per model, per process), and a streamed call holds its slot until the whole reply is written. So with the defaults, a second user's stream waits for the first user's reply to finish, and then shows nothing for that long. Set `concurrency` in the `GenerateCallManager` config to the number of replies you want to stream at once, and keep it within what your provider account allows (its requests and tokens per minute, and any limit on concurrent requests). Size `highPriorityTasksLimit`, the number of calls that may wait in the queue, for your bursts: the next call is rejected at once with `TooManyHighPriorityTasksError` (an `error` event with code `rate_limited`).
- **The limits are per process.** The queue and the `LlmTokenRateLimiter` live in memory, so every server instance has its own. Divide the budgets you got from the provider (`newTokensPerSecond`, `newRequestsPerSecond`, `maxTokens`, and the concurrency you can afford) by the number of instances that share the account.
- **Turn the SDK's own retries off.** The OpenAI and Anthropic SDK clients retry failed requests themselves (2 times by default). When LOFT's call manager retries too (`retryAttemptsLimit` above 1), the retries multiply, and the SDK's run inside one attempt, so no `request-start` or `status generating` event tells the client about them. Pass `clientOptions: { maxRetries: 0 }` to the OpenAI strategies, and `maxRetries: 0` in the client options that make up the first argument of `AnthropicCallStrategy`, and let the call manager retry.

```typescript
const callManager = new GenerateCallManager<OpenAiRequest, OpenAiResponse>(
  'gpt-4o-mini',
  { highPriorityTasksLimit: 50, retryDelay: 1000, retryAttemptsLimit: 3, concurrency: 8 },
  new OpenAiCallStrategy(apiKey, rateLimiter, tokenizer, { clientOptions: { maxRetries: 0 } })
);
```

See [LLM Strategies](./llm-strategies.md#rate-limiter-configuration) for the settings.

## Providers

| Provider | Streams | Notes |
| --- | --- | --- |
| OpenAI and Azure OpenAI | Yes | Requests with a `json_schema` response format or a `strict` tool are not streamed, because the SDK can return a different result for them. Their text arrives once, after the call. |
| Anthropic | Yes | Thinking arrives as reasoning, which reaches you only with `include.reasoning`. |
| Gemini | Yes | Thought summaries (with `includeThoughts`) arrive as reasoning. A request with a `candidateCount` above 1 is not streamed, because Vertex AI rejects it; its text arrives once, after the call. See [Content filters](#content-filters) for blocked replies. |
| A strategy that does not stream (an older provider package, a custom strategy), or `HttpCallManagerStrategy` | No | The events still arrive; each step's text comes in one piece after the call. |

Each call strategy takes an optional, experimental last constructor argument with `streaming` (default `true`). `streaming: false` makes that model's requests exactly as before, and LOFT sends each step's text once the call returns. The call manager still treats the call as streamed, so `streamFirstEventTimeoutMs` (10 minutes by default) bounds the whole call:

```typescript
new OpenAiCallStrategy(apiKey, rateLimiter, tokenizer, { streaming: false });
new AnthropicCallStrategy(config, rateLimiter, tokenizer, { streaming: false });
new GeminiCallStrategy(config, rateLimiter, tokenizer, { streaming: false });
```

The OpenAI strategies also take `streamUsage` (default `true`, asks for the usage at the end of the stream) and `clientOptions` (`{ timeout?, maxRetries? }` for the SDK client). See the [OpenAI](../../packages/loft-openai-strategy/README.md#streaming), [Anthropic](../../packages/loft-anthropic-strategy/README.md#streaming) and [Gemini](../../packages/loft-gemini-strategy/README.md#streaming) READMEs.

## Events

Every event has `type`, `seq` (0, 1, 2 … with no gaps, per `generate()` call) and `runId` (one per `generate()` call). Each LLM call of the tool loop is a **step**, numbered from 0.

| Event | Fields | Meaning |
| --- | --- | --- |
| `start` | `sessionId`, `textPolicy`, `streaming` | The generation started. `textPolicy` is the [text policy](#text-policy) that applies; `streaming` is false when the call is [observe-only](#observe-only-mode). |
| `step-start` | `step` | One LLM call starts. |
| `status` | `step`, `phase` | `queued` when the step starts, `generating` when the request goes out. For a streamed call, `generating` is sent again for every retry attempt of the step; for an observe-only call, or one through a call manager that does not pass `onEvent` on, it is sent once, when the call returns. |
| `text-delta` | `step`, `delta` | A piece of the reply text. |
| `reasoning-delta` | `step`, `delta` | A piece of the model's reasoning; only with `include.reasoning`. |
| `tool-call` | `step`, `toolCallId`, `name`, `args?` | The model called a tool. `args` only with `include.toolCalls: 'args'`. |
| `data` | `step`, `toolCallId`, `toolName`, `name`, `data` | Sent by a running tool through `context.emit()`. |
| `tool-result` | `step`, `toolCallId`, `name`, `status`, `durationMs` | The tool finished. `status` is `failed` when the tool's result is an error, otherwise `succeeded`. The tool's output is never sent. |
| `step-finish` | `step`, `reason`, `finishReason`, `hadToolCalls`, `streamed`, `usage?` | The step ended. `reason` is the [normalized finish reason](#finish-reasons); `finishReason` is the provider's own. |
| `finish` | `reason`, `finishReason`, `text`, `textReplaced`, `usage` | The generation ended. `text` is the final reply. `reason` is the [normalized finish reason](#finish-reasons) of the last step; `finishReason` is the provider's own. |
| `error` | `code`, `message`, `retryable`, `retryAfterMs?` | The generation failed. `retryAfterMs` is how long the provider asked clients to wait, in milliseconds. It is set only for `rate_limited` errors that carry a valid `Retry-After` (or `retry-after-ms`) header. |
| `abort` | `reason` | The generation was cancelled. `reason` is `timeout` when the signal was aborted by a timeout (as `AbortSignal.timeout()` does, also inside `AbortSignal.any()`), otherwise `cancelled`. |

A reply that calls a tool and then answers looks like this:

```
start
step-start 0, status queued, status generating
tool-call, data, data, tool-result
step-finish 0 (hadToolCalls: true)
step-start 1, status queued, status generating
text-delta, text-delta, …
step-finish 1
finish
```

### Rules

- **One final event.** Every call that sent `start` ends with exactly one `finish`, `error` or `abort`, and nothing comes after it. The final event matches what `generate()` does: `finish` when it resolves, `abort` or `error` when it rejects. An abort that arrives after the last LLM call returned does not stop the call, so it still ends with `finish` and `generate()` resolves.
- **`finish` comes before the tracer flush.** LOFT sends `finish` once the result is built, and then flushes the tracer. A client therefore does not wait for the trace to be sent. A flush that fails after a successful generation is logged (name and code only) and does not fail the call: `generate()` resolves, and no `error` event follows `finish`. See [Tracing](./tracing.md#flushing).
- **Silent before `start`.** A failure before `start` sends no event at all, and `generate()` rejects as before. That covers loading the session and its history, message validation, input middleware, Focus, `ALREADY_GENERATED`, the BeforeGenerate middleware and an unknown LLM name. An HTTP handler can still answer those with a status code, because it has written nothing yet.
- **Order.** `seq` always grows by one. Steps never interleave. Within a step the order is `step-start`, `status queued`, `status generating`, the text and reasoning deltas, then for each tool in the order the tools run: `tool-call`, its `data` events, `tool-result`; and last `step-finish`.
- **`status generating` can repeat.** Each retry attempt of a step sends `status generating` again, so a step can carry it more than once. A client that maps it to a one-time state, such as a "thinking" indicator, should deduplicate it per step.
- **`finish.text` is the reply.** It is the final text after the strategy's middleware and the AfterGenerate middleware. `textReplaced` is true when it differs from the text deltas of the last step, for example when a middleware changed it. Show `finish.text` in place of what the deltas built up.
- **`step-finish.streamed`** is true when the step's text reached you as the provider wrote it. It is false when the text came in one piece after the call, or the step had no text, such as a step that only called tools.
- **Text after the call.** When a step's provider streamed no text but the step has text (a provider that does not stream, a request it does not stream, or an observe-only call), LOFT sends that text as one `text-delta` after the call.
- **Replies that do not come from the model.** When a BeforeGenerate middleware prevents generation, or a tool interceptor overrides the reply, the reply's text is sent once, in a step of its own just before `finish`, after the AfterGenerate middleware.
- **The tool-loop limit** ends with `finish` with `finishReason: 'max_loops_exceeded'`, `reason: 'other'` and empty `text`. LOFT's internal limit message is never sent.
- **Unknown tools.** A call to a tool that no tool source has is reported with the name `'unknown'` and `status: 'failed'`, never with the name the model made up.
- **`tool-call.args`** is a copy: changing it does not change what the tool receives. Arguments that cannot be copied are left out.
- **A throwing callback** is caught and logged with the event type only, and the generation goes on. `onEvent` is called synchronously and its result is not awaited. An `async` callback is accepted, but the promise it returns is not awaited either: LOFT does not wait for it and does not slow down for it, and if it rejects, the rejection is contained and logged with the event type only, like a throw. So a slow `await` inside it does not give you backpressure; do slow work elsewhere, and do not let a slow client hold up the callback.
- **Ignore what you do not know.** New event types, fields and error codes may be added in a minor release. An exhaustive `switch` with a compile-time `never` check over these unions is not covered by semver.

### Text deltas

- **Deltas are passed on as the provider sends them.** LOFT never splits or regroups them, so a delta boundary can fall inside a grapheme cluster, such as an emoji joined with ZWJ or a letter with a combining mark. Render the text joined so far, not each delta on its own. A transport should JSON-encode each delta, as the SSE example does, so no character is broken on the wire.
- **Delta size differs by provider.** Roughly one token per delta for OpenAI, a few tokens for Anthropic, and tens of tokens for Gemini. Do not rely on a particular size or rate.
- **A tool step can carry text.** A model may write a short preamble ("Let me look that up") before it calls a tool. Under `'all'` that text streams in the tool step, but it is not part of `finish.text`, which is the final step's reply. Clear it or keep it apart when the final reply arrives.

### Finish reasons

`step-finish` and `finish` carry two fields. `finishReason` is the provider's own string, as it sent it (`stop`, `tool_calls`, `end_turn`, `STOP`, `SAFETY` …), and differs between providers. `reason` is LOFT's normalized value, the same for every provider, so a client needs no table of provider strings:

| `reason` | Means | Provider values it covers |
| --- | --- | --- |
| `stop` | The model finished its reply. | OpenAI `stop`; Anthropic `end_turn`, `stop_sequence`; Gemini `STOP` |
| `length` | The reply hit the token limit. | OpenAI `length`; Anthropic `max_tokens`, `model_context_window_exceeded`; Gemini `MAX_TOKENS` |
| `content-filter` | A safety filter or a refusal stopped the reply, maybe after some text was shown. | OpenAI `content_filter`; Anthropic `refusal`; Gemini `SAFETY`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, `IMAGE_SAFETY`, `IMAGE_PROHIBITED_CONTENT`, `IMAGE_RECITATION` |
| `tool-calls` | The step ended because the model called tools. | OpenAI `tool_calls`, `function_call`; Anthropic `tool_use`; and a `STOP` that came with tool calls (Gemini ends such a step with `STOP`) |
| `error` | The provider failed to finish the reply. | Gemini `MALFORMED_FUNCTION_CALL` |
| `other` | Anything else, including a reason LOFT does not know and the tool-loop limit (`max_loops_exceeded`). | Anthropic `pause_turn`; Gemini `LANGUAGE` (an unsupported language) and its other values |

Check `reason`, for example `event.reason === 'content-filter'`, and not the provider strings. The union of `reason` values may gain a value in a minor release, so keep a default branch. `finishReason` stays for logs and for provider-specific handling.

### Usage

`step-finish.usage` is the usage of that step's LLM call. `finish.usage` is the total over the LLM calls of the generation that completed: the token and cost fields summed, `model` and `finishReason` from the last call. A reply that did not come from the model adds zero. This differs from `result.messages.llmResponse.usage`, which stays the usage of the last LLM call only.

`finish.usage` is not the bill. A call that was aborted or that failed (a client that disconnected, a timeout, an error in the middle of a stream) has no usage to report, but the provider has usually still run it, and bills the tokens it produced. LOFT keeps the rate limiter's reservation for a call aborted after it took the reservation, but the abort and error events carry no usage. For cost accounting use the provider's own usage reports, not the sum of `finish.usage`.

## Options

Set the defaults for every call in `ChatConfig.streaming` (the fifth `ChatConstructor` argument), and override them per call with `streamOptions`. The per-call options are merged over the defaults key by key. Both are ignored when the call has no `onEvent`.

```typescript
const chatConstructor = new ChatConstructor(sessionRepoConstructor, chatHistoryRepoConstructor, undefined, undefined, {
  streaming: { include: { toolCalls: 'names' } }
});

await loft.chat.generate({
  sessionId,
  directMessages,
  onEvent,
  streamOptions: { include: { reasoning: true }, textPolicy: 'all' }
});
```

| Option | Default | Effect |
| --- | --- | --- |
| `enabled` | `true` | `false` makes the call [observe-only](#observe-only-mode). |
| `include.reasoning` | `false` | Sends `reasoning-delta` events. |
| `include.toolCalls` | `'names'` | `'none'` sends neither `tool-call` nor `tool-result`; `'names'` sends both without arguments; `'args'` adds the parsed arguments to `tool-call`. `data` events are sent under every setting. |
| `textPolicy` | see below | `'all'` or `'after-middleware'`. |

### Text policy

- **`'all'`** sends the text as the model writes it.
- **`'after-middleware'`** sends no text while the model writes. Once the middleware has run, the final text is sent once, in a step of its own just before `finish`. Text of the intermediate tool rounds is never sent. Reasoning still follows `include.reasoning`, and is not held back.

Without a chosen policy, LOFT holds text back (`'after-middleware'`) when a middleware that may change the reply is registered: an AfterGenerate middleware, or a middleware registered on the strategy with `useMiddleware`. Otherwise it uses `'all'`. A strategy without `hasOutputMiddleware()` counts as having such middleware. When LOFT picks `'after-middleware'` this way, it logs a warning that names the middleware, once per process for each set of middleware, and `start.textPolicy` says which policy applies.

> **Streamed text skips your output middleware.** A middleware that redacts, filters or rewrites the reply runs after the model has finished. Under `'all'`, the client has already seen the text the model wrote before the middleware changed it; only `finish.text` carries the changed text. Keep the default, or set `textPolicy: 'after-middleware'`, wherever a middleware guards what users may see. A middleware that only reads the reply (logging, metrics) can be registered with `{ transformsOutput: false }`, so it does not hold text back. See [Middleware](./middleware.md#aftergenerate-middleware).

### Observe-only mode

With `enabled: false`, LOFT does not ask the providers to stream: they make exactly the calls they make without `onEvent`, with the same retries and no stream timeouts. All other events still arrive, and each step's text comes in one piece after its call (or once at the end under `'after-middleware'`). `start.streaming` is `false`.

The same mode applies on its own when streaming could deliver nothing: `textPolicy: 'after-middleware'` without `include.reasoning`.

`enabled: false` in `ChatConfig.streaming` is the switch to turn provider streaming off for the whole application without touching the callers.

**Events for an endpoint that does not stream.** Observe-only also serves a plain REST endpoint that answers with the whole reply but still wants to know what happened during the call, for an audit trail or a side effect in the UI. The provider makes its usual call, and the steps, tool calls with their arguments, `data` events and `finish` still arrive:

```typescript
const toolCalls: Chat.ChatStreamEvent[] = [];
const result = await loft.chat.generate({
  sessionId,
  directMessages,
  streamOptions: { enabled: false, include: { toolCalls: 'args' } },
  onEvent: (event) => {
    if (event.type === 'tool-call' || event.type === 'data') toolCalls.push(event);
  }
});
await audit.record(sessionId, toolCalls);
```

## Tool Data Events

A tool handler can send its own events to the client through `context.emit(name, data)`, for example its progress:

```typescript
import { Chat } from '@moc-global/loft-definitions';

const lookupOrder: Chat.AdditionalTool = {
  definition: {
    name: 'lookup_order',
    description: 'Looks up an order by its id',
    inputSchema: { type: Chat.AdditionalToolSchemaType.OBJECT, properties: { orderId: { type: 'string' } } }
  },
  async handler(args, context) {
    context?.emit('progress', { stage: 'loading' });
    const order = await orders.find(String(args.orderId), { signal: context?.signal });
    context?.emit('progress', { stage: 'done' });
    return { content: [{ type: Chat.AdditionalToolContentType.TEXT, text: JSON.stringify(order) }] };
  }
};
```

- LOFT adds the step, the tool call id and the tool name, and sends the `data` event between the tool's `tool-call` and `tool-result`.
- `emit` does nothing when the caller passed no `onEvent`, once the tool has finished, and after the call has ended.
- `data` events are never saved to the chat history. Whatever must be kept goes into the tool's result.
- LOFT does not check or log the payload, and does not hold it back under `'after-middleware'`. Do not put model output or secrets in it.
- MCP tools cannot emit, and middleware cannot emit yet.

See [Additional Tools](./tools.md#emit).

## Errors

`error.message` is a fixed text for each code, never the provider's message. The full error stays on the rejected `generate()` promise, for your logs.

| `code` | `message` | `retryable` |
| --- | --- | --- |
| `provider_error` | The model provider returned an error. | When the call manager would retry it: a 408 or 5xx, a network failure that the SDK reports as its own error (such as `APIConnectionError`), a stream cut short, or a provider error such as `overloaded_error` |
| `rate_limited` | Too many requests. Try again shortly. | Always |
| `timeout` | The response took too long. | Always |
| `internal` | Failed to generate a response. | Never |

A `rate_limited` error carries `retryAfterMs` when the provider's response had a valid `Retry-After` (or `retry-after-ms`) header: the wait the provider asked for, in milliseconds, as sent (the call manager caps its own retry waits at 60 s, this value is not capped). A client can show it, or send it on as a `Retry-After` header. It is absent without such a header, and on every other code.

The code is chosen from the error's structure, never from the provider's message: LOFT's own errors by their name (`StreamIdleTimeoutError` is `timeout`; `TooManyHighPriorityTasksError` and `LlmCallManagerLongAwaitError` are `rate_limited`), provider errors by their HTTP status (429 is `rate_limited`, any other status `provider_error`), and a provider SDK error without a status (an error raised in the middle of a stream, a stream cut short, or a network failure the SDK reports as its own error, such as `APIConnectionError`) as `provider_error`. A network failure without a status that the call manager retries (a connection reset or closed in the middle of a stream, such as undici's `TypeError: terminated` with an `UND_ERR_SOCKET` cause, an `ECONNRESET`, or a `TypeError: fetch failed`) is also `provider_error`, with `retryable: true`. Any other error without a status is `internal`, with `retryable: false`. An aborted signal always gives `abort`, not `error`.

A stream that ends before the reply is complete (before OpenAI's last finish, Anthropic's `message_stop` or Gemini's last finish) rejects with a retryable error: `APIConnectionError` for OpenAI and Anthropic, and for Gemini an `ApiError` with status 502 that says no HTTP error occurred. When the SDK raised an error, it is the `cause`. The call manager retries it while nothing was delivered, and the chat reports it as `provider_error`. For OpenAI and Gemini, when every choice or candidate had already finished, a stream cut short in its last bytes resolves with what arrived; for OpenAI, a lost usage chunk then means token accounting falls back to 500 tokens.

## Retries, Timeouts and Concurrency

The call manager (`GenerateCallManager`) treats a streamed call as it treats any other, with three differences:

- **No retry after text reached the client.** A failed attempt is retried as before only while nothing it sent reached your callback. Once a delta was delivered, a new attempt would repeat it, so the call fails instead. Under observe-only nothing is delivered, so retries work as without streaming. Under `'after-middleware'` no text is delivered, but with `include.reasoning` a delivered reasoning delta also ends retries.
- **`streamIdleTimeoutMs`** (default 60 000, `0` turns it off) aborts an attempt that stays silent for that long between two provider events. It starts at the first text, reasoning or other sign of progress from the provider. A token-usage report does not start it: Anthropic sends one as soon as the message starts, and a model can then think silently for longer than the timeout. Once the timer has started, every provider event, usage reports included, restarts it.
- **`streamFirstEventTimeoutMs`** (default 600 000, 10 minutes like the SDKs' request timeout; `0` turns it off) aborts an attempt that waits that long for its first output: text, reasoning or other progress. A usage report does not count, so it does not end this timer either. Reasoning models can think for minutes before the first token, so keep it above your longest silent reasoning. It also bounds calls the provider answers without streaming (an OpenAI `json_schema` request or `strict` tool, a Gemini request with a `candidateCount` above 1, a provider that does not stream, a strategy built with `streaming: false`), which send nothing until the whole answer arrives, so set it above your longest non-streamed answer.

A model that thinks silently, with no reasoning text sent, before its first output is bounded by `streamFirstEventTimeoutMs`; the idle timeout does not cover that wait. The SDKs' request timeout (`clientOptions.timeout`, or the Anthropic client's `timeout`) covers only the wait for the response headers, not the stream. So a running stream is bounded by `streamFirstEventTimeoutMs` until its first output, then by `streamIdleTimeoutMs`, and by the call's `signal` (for example `AbortSignal.timeout()`). With `streamFirstEventTimeoutMs: 0`, pass a signal with a deadline.

A timeout rejects with `StreamIdleTimeoutError` (from `@moc-global/loft-definitions`), which is retried while nothing was delivered and becomes an `error` event with code `timeout`. Neither timeout applies to observe-only calls or calls without `onEvent`.

By default a call manager runs one call of its model at a time, so a second chat waits until the first one's reply is complete. Set `concurrency` to let several stream at once. Each call manager serves one model, so the limit is per model and per process; keep it within your provider's rate limits (divided by the number of instances), and size `highPriorityTasksLimit` (the calls that may wait in the queue) for your traffic. See [Before you serve more than one user](#before-you-serve-more-than-one-user) and [LLM Strategies](./llm-strategies.md#rate-limiter-configuration).

The SDK clients retry too, unless you turn it off with `maxRetries: 0`. Their retries multiply LOFT's and run without a `request-start` event.

## Saving, Aborts and Failures

- **`finish` is not a save.** It means the generation ended. Call `result.messages.save()` after `generate()` returned, as without streaming.
- **An abort or an error saves nothing.** `generate()` rejects, so there is no result to save, and the text the client already saw is not stored. The user's message stays in the history if you stored it before the call.
- **Tools that finished are not saved either.** When a call aborts or fails after a tool step completed, the tool's result is lost with the rest of the turn, but the tool has already run. The next turn can ask for it again, so a tool with side effects (sending a message, charging a card, writing a row) may run twice. Make such tools idempotent, for example with a key derived from the session and the request, or let the generation finish and be saved after a disconnect, as the example's `onDisconnect: 'finish'` does (see [Serving over HTTP](#serving-over-http)).
- **An aborted call is still billed.** Aborting stops LOFT from waiting for the reply, and the provider usually stops generating, but the tokens produced up to then are billed. See [Usage](#usage).
- **`shutdown()` does not abort.** It waits for running calls, as before, and sends no event. To end streams on shutdown, abort your own signals, as the example's `closeStreams()` does.

## Content Filters

A provider can stop a reply after some text was already sent. Check `finish.reason === 'content-filter'`, which is the same for every provider (see [Finish reasons](#finish-reasons)). `finish.finishReason` still carries the provider's own value, such as OpenAI's `content_filter` or Gemini's `SAFETY`, for your logs.

When a Gemini filter blocks the reply (`SAFETY`, `RECITATION`, `SPII` or `PROHIBITED_CONTENT`), the reply has no text, as without streaming, so `finish.text` is empty, and `textReplaced` is true when text was already shown: replace what the deltas showed. Where a filtered partial reply must never be shown, keep text back with `'after-middleware'`.

## Serving Over HTTP

LOFT does not write HTTP responses; you map the events to your transport. The [express-streaming](../../examples/express-streaming/) example has a complete SSE writer (`src/sse.ts`). Its main points:

- **Write the headers on `start`.** Until then nothing was sent, so an error before `start` can still be answered as JSON with a status code (404 for an unknown session, 409 for `ALREADY_GENERATED` or a busy session).
- **Headers:** `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-store, no-transform`, `X-Accel-Buffering: no` (nginx) and `X-Content-Type-Options: nosniff`.
- **Frames:** `event: <type>`, `data: <the event as single-line JSON>`, and a blank line. Take the event name only from `event.type`, never from a `data` event's `name`. Drop a payload that cannot be serialised, and go on.
- **Heartbeat:** a `: ping` comment every 15 seconds, so proxies keep the connection open.
- **Slow clients:** `onEvent` is not awaited, so the writer must bound its own buffer. The example ends the response and aborts the generation when more than 1 MiB waits to be sent.
- **Token usage** stays on the server in the example: it removes `usage` from the frames.
- **Disconnects.** Choose a policy:
  - `'abort'` (the example's default): closing the connection aborts the generation, and nothing is saved.
  - `'finish'`: the generation runs to the end and is saved, even when nobody reads it. Give it a deadline (`AbortSignal.timeout()`), and allow one generation per session at a time, so a second message waits (409) until the first is saved.
- **One generation per session.** Two generations on one session at the same time would both reply to the same history. The example keeps an in-process set of busy sessions; with more than one server instance, use a distributed lock (for example in Redis or PostgreSQL).

The example README has a browser snippet that reads the stream with `fetch` and `TextDecoderStream`, splits frames on blank lines and stops with an `AbortController`, and a "Before production" checklist.

A minimal version with `node:http` is in the [`@moc-global/loft` README](../../packages/loft/README.md#streaming).

## Migrating a Custom Streaming Call Manager

An application that streamed below LOFT, with a custom `Strategy.CallManager` that streams from the provider and hands LOFT the final completion, can move to `onEvent`:

1. **Replace the custom call manager** with `NativeCallManagerStrategy` around a `GenerateCallManager`, and pass `onEvent` to `generate()`. The provider strategy now streams, and rate limits, retries and token accounting are LOFT's.
2. **Keep your wire format.** Map `ChatStreamEvent` to the frames your clients already understand in a small adapter. Drop events your clients do not need.
3. **Send tool progress through `context.emit()`** instead of looking up an emitter by session id. It arrives as a `data` event of the same call.
4. **Keep your own emitter for events outside `generate()`,** such as frames you send from hooks before the call or a closing frame after `save()`.
5. **Keep a session lock,** so one session runs one generation at a time. It no longer needs to hold emitters.
6. **Use `concurrency`** per model instead of a process-wide semaphore around the provider. The two behave differently under a burst: a semaphore makes every extra call wait, while a model's queue runs `concurrency` calls, keeps up to `highPriorityTasksLimit` waiting, and rejects the next one at once with `TooManyHighPriorityTasksError` (an `error` event with code `rate_limited`). Size `highPriorityTasksLimit` for your bursts.
7. **Give calls that need other retry settings their own strategy:** register a second strategy, with its own call manager, under another LLM name, add that LLM name to the manifest, and pick it with `temporaryLlmName`.

## Deprecated Stream API

The older stream building blocks never ran through `chat.generate()`. They are deprecated and are removed in the next major release; use `chat.generate({ onEvent })` instead:

- `Strategy.LLM.LLMApi.generateStream` and `extractContentFromChunk`, and the `generateStream` method of every strategy
- `Strategy.CallManager.streamCall`, `Strategy.LLM.LoftLLM.generateStream` and `Interface.LlmManager.generateStream`
- `Strategy.LLM.UnifiedLLMStream` and `UnifiedLLMChunkResponse`
- `GenerateWithStreamManager` and `GeminiStream`
- `Chat.Status.SUCCESS_STREAM`

`DI_TYPES.StreamLoft` is reserved and unused.

Queued generation is still not available. Its symbols are marked `@experimental` and may change or be removed in any release.

## What's Next

- [Additional Tools](./tools.md) — the tool handler's `signal` and `emit`
- [Middleware](./middleware.md) — `transformsOutput` and output middleware
- [Error Handling](./error-handling.md) — retries and error types
- [Strategy Pattern](../concepts/strategy-pattern.md#supporting-streaming-in-a-provider-strategy) — how a provider strategy supports streaming
