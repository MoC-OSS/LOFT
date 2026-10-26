# express-streaming

Express + LOFT + OpenAI example that streams a chat reply over Server-Sent Events (SSE). The model can call two tools, and one of them reports its progress to the client while it runs. PGLite as the database: no Docker, no external database.

> **Not for production.** This example has no authentication or authorization and uses demo settings. Use it to learn LOFT, not as a template for a deployed service: see [Before production](#before-production).

> **Experimental.** Streaming (`onEvent`, the event types and the tool `emit`) is experimental in LOFT and may change in a minor release.

## What this example demonstrates

- `chat.generate({ onEvent })`: the reply arrives as events (`start`, text deltas, tool calls, `finish` …) while the model writes it
- An SSE writer (`src/sse.ts`) that turns those events into frames, with heartbeats, a buffer limit for slow clients and a disconnect policy
- Tool calling with `additionalTools`, and a tool that sends `data` events to the client through `context.emit()`
- Errors before the stream starts answered as JSON with a status code (404, 409, 500); errors after it as an `error` event
- One generation per session at a time (409 for a second one)
- Saving the reply with `result.messages.save()` after `finish`; an aborted or failed generation saves nothing
- A call manager with `concurrency: 2` and a `streamIdleTimeoutMs`
- Route tests that run offline with a scripted model (`pnpm --filter @moc-global/example-express-streaming test`)

## Prerequisites

- Node.js 22.12+
- An OpenAI API key

## Quick start

```bash
# From monorepo root
pnpm install

# Build the example and all its LOFT dependencies
pnpm turbo build --filter=@moc-global/example-express-streaming...

# Set up environment
cp examples/express-streaming/.env.example examples/express-streaming/.env
# Edit .env and set your OPENAI_API_KEY

# Run
pnpm --filter @moc-global/example-express-streaming start

# In another terminal: create a session and stream a reply that calls lookup_order
./examples/express-streaming/test-chat.sh
```

## API

### POST /sessions

Creates a chat session. **Response (200):** `{ "sessionId": "550e8400-..." }`

### POST /chat/stream

Stores the user message, then streams the reply as `text/event-stream`.

**Request:**

```json
{ "sessionId": "550e8400-...", "message": "What is the status of my order A-1001?" }
```

`sessionId` must be a UUID (any case), the body at most 32 kB, and `message` at most 4000 characters.

**Errors before the stream starts** come as JSON with a status code, and no event is sent:

| Status | When |
|---|---|
| 400 | `sessionId` is not a UUID, `message` is missing, or the message is too long |
| 404 | The session does not exist |
| 409 | A reply is already being generated for this session, or there is no new message to reply to |
| 503 | The server is shutting down |
| 500 | Anything else (the details stay in the server log) |

**Response (200):** the headers are sent with the first event:

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-store, no-transform
X-Accel-Buffering: no
X-Content-Type-Options: nosniff
```

Each event is one frame: an `event:` line with the event type, a `data:` line with the event as single-line JSON, and a blank line. A `: ping` comment is sent every 15 seconds so proxies keep the connection open. Every event has `seq` (0, 1, 2 … per call) and `runId` (one per call). `seq` can have gaps on the wire: the writer drops a frame whose `data` payload cannot be serialised (see below).

### GET /sessions/:id/history

All stored messages of the session: `{ "sessionId": "...", "messages": [...] }`

## Events

In the order they arrive. A tool round is one step; the reply after it is the next step.

| Event | Sample `data` | Meaning |
|---|---|---|
| `start` | `{"type":"start","sessionId":"ce61…","textPolicy":"all","streaming":true,"seq":0,"runId":"dbe7…"}` | The generation started |
| `step-start` | `{"type":"step-start","step":0,"seq":1,"runId":"dbe7…"}` | One model call starts |
| `status` | `{"type":"status","step":0,"phase":"queued","seq":2,"runId":"dbe7…"}` | `queued`, then `generating` when the request goes out |
| `text-delta` | `{"type":"text-delta","step":1,"delta":" order","seq":13,"runId":"dbe7…"}` | A piece of the reply text |
| `reasoning-delta` | `{"type":"reasoning-delta","step":0,"delta":"…","seq":4,"runId":"dbe7…"}` | Reasoning text; only when enabled with `streamOptions.include.reasoning` |
| `tool-call` | `{"type":"tool-call","step":0,"toolCallId":"call_461r…","name":"lookup_order","seq":4,"runId":"dbe7…"}` | The model called a tool (no arguments by default) |
| `data` | `{"type":"data","step":0,"toolCallId":"call_461r…","toolName":"lookup_order","name":"progress","data":{"stage":"loading"},"seq":5,"runId":"dbe7…"}` | Sent by a running tool, see below |
| `tool-result` | `{"type":"tool-result","step":0,"toolCallId":"call_461r…","name":"lookup_order","status":"succeeded","durationMs":303,"seq":7,"runId":"dbe7…"}` | The tool finished (its output is never sent) |
| `step-finish` | `{"type":"step-finish","step":0,"reason":"tool-calls","finishReason":"tool_calls","hadToolCalls":true,"streamed":false,"seq":8,"runId":"dbe7…"}` | The model call ended |
| `finish` | `{"type":"finish","reason":"stop","finishReason":"stop","text":"Your order A-1001 has been shipped. …","textReplaced":false,"seq":49,"runId":"dbe7…"}` | The generation ended; `text` is the final reply |
| `error` | `{"type":"error","code":"provider_error","message":"The model provider returned an error.","retryable":false,"seq":7,"runId":"dbe7…"}` | The generation failed; a `rate_limited` error also has `retryAfterMs` when the provider said how long to wait |
| `abort` | `{"type":"abort","reason":"cancelled","seq":7,"runId":"dbe7…"}` | The generation was cancelled; `reason` is `timeout` when the `maxGenerationMs` deadline ended it |

- After `start`, exactly one of `finish`, `error` or `abort` comes last, and then the response ends.
- **Show `finish.text`.** It is the final reply after LOFT's middleware, and it may differ from the deltas (`textReplaced: true`). Also check `reason`: `content-filter` means a filter stopped the reply, maybe after some text was shown, and `length` that it hit the token limit. `reason` is the same for every provider (`stop`, `length`, `content-filter`, `tool-calls`, `error`, `other`); `finishReason` is the provider's own value.
- `error.message` is a fixed text per `code` (`provider_error`, `rate_limited`, `timeout`, `internal`), never the provider's message.
- Token usage is removed from the frames (`usage` on `step-finish` and `finish`); it stays on the server.
- **Ignore event types you do not know.** New ones can be added in a minor release. The writer skips them as well.

### `data` events from tools

A tool handler gets a `context` with `emit(name, data)` and the generation's `signal`:

```ts
async handler(args, context) {
  context?.emit('progress', { stage: 'loading' });
  await delay(300, undefined, { signal: context?.signal }); // stops when the generation is cancelled
  context?.emit('progress', { stage: 'done' });
  return { content: [{ type: Chat.AdditionalToolContentType.TEXT, text: JSON.stringify(order) }] };
}
```

LOFT adds the step, the tool call id and the tool name, and sends the event between the tool's `tool-call` and `tool-result`. `data` events are never saved to the chat history: whatever must be saved goes into the tool's result. LOFT does not check the payload, so do not put model output or secrets in it. The SSE event name is always `data`, whatever `name` the tool chose. A payload that cannot be serialised (a `BigInt`, a cycle) is dropped with its frame, and the stream goes on, so the frames' `seq` has a gap there. A payload that is `undefined`, a function or a `Symbol` arrives as a `data` event without a `data` field.

## Frontend snippet

```js
async function streamReply(sessionId, message, { onText, onData, signal }) {
  const response = await fetch('/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message }),
    signal
  });
  if (!response.ok) throw new Error((await response.json()).error); // 400, 404, 409, 500, 503

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const frames = buffer.split('\n\n');
    buffer = frames.pop(); // an incomplete frame waits for the next chunk
    for (const frame of frames) {
      if (frame.startsWith(':')) continue; // heartbeat
      const type = frame.match(/^event: (.*)$/m)?.[1];
      const data = JSON.parse(frame.match(/^data: (.*)$/m)?.[1] ?? 'null');
      switch (type) {
        case 'text-delta':
          onText(data.delta, false);
          break;
        case 'data':
          onData(data.name, data.data);
          break;
        case 'finish':
          onText(data.text, true); // authoritative: replace what the deltas showed
          break;
        case 'error':
          throw new Error(data.message);
        case 'abort': // cancelled on the server (a deadline, a slow connection or a shutdown): show it
          throw new Error('The reply was cancelled on the server');
        default:
          break; // unknown and other events are ignored
      }
    }
  }
}

// A stop button. The user's own Stop rejects with an AbortError, which is no error to show.
// A broken connection (even after `finish`) rejects with a TypeError: the reply may not have been saved.
const controller = new AbortController();
streamReply(sessionId, 'Where is order A-1001?', { onText, onData, signal: controller.signal }).catch((e) => {
  if (e.name !== 'AbortError') showError(e);
});
stopButton.onclick = () => controller.abort();
```

## Disconnect policy

`createApp(chat, { sse: { onDisconnect } })` in `src/index.ts`. `createApp` checks the options, so a policy that cannot work fails at startup:

- **`'abort'` (default):** when the client closes the connection, the generation is aborted, and nothing is saved.
- **`'finish'`:** the generation runs to the end and the reply is saved, even when nobody reads it any more. It needs a deadline: `{ onDisconnect: 'finish', maxGenerationMs: 120_000 }`. A second message for the session gets 409 until the generation ended.

On shutdown (SIGINT or SIGTERM), `closeStreams()` aborts the running generations, so their clients get an `abort` event, and waits up to 10 seconds for them to end before LOFT and the database are closed. New streams then get 503.

A client that reads too slowly (more than `maxBufferedBytes`, 1 MiB by default, waiting to be sent) is disconnected, and the generation is aborted. The largest single frame does not count toward the limit, so a long reply in one delta, or the `finish` frame of a long reply, still reaches a client that reads at once.

## Saving

`finish` does not mean the reply was saved: the route calls `result.messages.save()` after `generate()` returned, and ends the stream after the save. An `abort` or `error` saves nothing; the user message stays in the history, so the next message continues from it. If the save fails, the server logs it and breaks the connection instead of ending the stream cleanly: a stream that breaks, even after `finish`, means the reply may not have been saved.

## Before production

- **Authentication:** every route is open.
- **Session ownership:** check that the session belongs to the caller (see the `SECURITY:` comment in `src/app.ts`). Anyone who knows a session id can use it here.
- **Rate limits:** per user and per IP, for sessions and for messages. Each message costs a model call.
- **A distributed session lock:** the in-process `Set` that allows one generation per session only works with one server instance. Use a lock in Redis or PostgreSQL with more than one.
- **No wildcard CORS:** allow only your frontend's origin.
- **Proxies:** keep response buffering off for this route (nginx: the `X-Accel-Buffering: no` header does it) and set the read timeout above the heartbeat interval.

## Testing

```bash
# Offline: SSE writer and route tests with a scripted model and PGLite (no API key)
pnpm --filter @moc-global/example-express-streaming test

# Live, against the running server
./examples/express-streaming/test-chat.sh
./examples/express-streaming/test-chat.sh 4000   # custom port
```

## Project structure

```
examples/express-streaming/
  manifest/
    manifest.json       # LLM manifest (order-assistant / gpt-4o-mini)
  src/
    config.ts           # Zod env validation
    database.ts         # PGLite init + auto-migration
    loft.ts             # LOFT wiring (call manager with concurrency 2, OpenAI strategy)
    tools.ts            # lookup_order (emits progress data events) and get_delivery_window
    sse.ts              # The SSE writer
    app.ts              # Express routes (sessions, chat stream, history) and closeStreams() for shutdown
    index.ts            # Boots PGLite + LOFT + the app, graceful shutdown
    sse.test.ts         # Writer tests
    streamRoute.test.ts # Route tests with a scripted model
    scenarios.test.ts   # Scenario tests with a scripted model
  .env.example          # Environment template
  test-chat.sh          # Quick test script
  package.json
  tsconfig.json
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes (to run the server) | — | Your OpenAI API key; the tests do not need it |
| `PORT` | No | `3007` | Server port |
| `LOFT_LOG_LEVEL` | No | `INFO` | Log level (TRACE, DEBUG, INFO, WARN, ERROR, FATAL, NONE) |
| `LOFT_SESSION_SCHEMA` | No | `loft_session` | PostgreSQL schema for sessions |
| `LOFT_CHAT_HISTORY_SCHEMA` | No | `loft_chat_history` | PostgreSQL schema for chat history |
| `LOFT_MANIFEST_PATH` | No | `manifest/manifest.json` | Path to the LLM manifest file |
| `LOFT_MANIFEST_ERROR_PATH` | No | `manifest/errors/error.json` | Path to the error manifest file |
| `LOFT_MANIFEST_CACHE_EXPIRATION` | No | `3600000` | Manifest cache TTL in ms |

## Using as boilerplate

1. Copy the `examples/express-streaming/` directory to a new project
2. In `package.json`, replace `workspace:*` with published version numbers, and drop `@moc-global/loft-test-suite` (a private workspace package) together with `src/streamRoute.test.ts` and `src/scenarios.test.ts`, or replace the scripted model in them with your own stub
3. Run `pnpm install` and follow the `.env.example`

## Next steps

- **[express-history](../express-history/)** — The same chat without streaming
- **[express-full](../express-full/)** — Middleware pipeline, dynamic prompts, Docker PostgreSQL, Anthropic
- [Streaming guide](../../docs/guides/streaming.md)
