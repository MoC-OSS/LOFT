# @moc-global/loft

## 3.0.0

### Major Changes

- bc747ee: Move from zod 3 to zod 4. The `zod` peer dependency is now `^4.6.6`, the first version without [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), a memory exhaustion while validating large arrays that affects every zod 3 release. zod 3 is no longer supported.

  To upgrade:

  - Install zod 4: `npm install zod@^4.6.6`.
  - Build the schemas you pass to LOFT with zod 4, such as the one given to `useLlmManifestSchema()` or returned by a custom strategy's `generateRequestValidationSchema()`.
  - Code that uses the schemas LOFT exports (`Schema.*`) with zod 3 APIs needs the zod 4 changes, see the [zod 4 migration guide](https://zod.dev/v4/changelog). Validation error messages read differently, for example `Invalid input: expected string, received number`.
  - `@moc-global/loft-openai-strategy` needs openai 7 (`^7.34.0`). openai 4 is no longer supported: it has had no release since May 2025, and it declares zod 3 as a peer, so npm refuses to install it next to zod 4. See the [openai-node migration guide](https://github.com/openai/openai-node/blob/main/MIGRATION.md) for the changes between the SDK majors.

### Patch Changes

- Updated dependencies [bc747ee]
  - @moc-global/loft-definitions@2.0.0

## 2.11.0

### Minor Changes

- 9da30fb: `chat.generate()` can now report its progress as events (experimental). Pass `onEvent` to receive them, in order, while the reply is generated: `start`, then per LLM call `step-start`, `status` (`queued`, then `generating`), the text as `text-delta` events, `tool-call`, `data` and `tool-result` for each tool, and `step-finish`. Every call that emitted `start` ends with exactly one `finish`, `error` or `abort`, and nothing comes after it. A failure up to and including the BeforeGenerate middleware (a missing session, invalid messages, input middleware, `ALREADY_GENERATED`, BeforeGenerate itself, the context update that follows it, an unknown LLM name) emits nothing, and `generate()` rejects as before. `error` events carry a fixed message per code (`provider_error`, `rate_limited`, `timeout`, `internal`), never the provider's text; the full error stays on the rejected promise. `finish` is sent last, after the AfterGenerate middleware and Focus post-processing but before the tracer flush, and does not mean the reply was saved. `finish.text` is the final reply text, the one to show. Without `onEvent` nothing changes, and `streamOptions` passed without `onEvent` are ignored.

  `ChatConfig.streaming` sets the defaults for every call, and a call's `streamOptions` are merged over them, key by key. The options are `include.reasoning` (default `false`), `include.toolCalls` (`'none'`, `'names'` (default) or `'args'`), `textPolicy` and `enabled`.

  - **Text policies.** `'all'` sends the text as the model writes it. `'after-middleware'` sends no text while the model writes, and sends the final text once, after the middleware has run. Without a chosen policy, text is held back (`'after-middleware'`) when a middleware that may change the reply is registered, and LOFT then logs a warning once that names it; otherwise it is sent as it arrives. `start.textPolicy` says which policy applies.
  - **Observe-only.** `enabled: false` keeps the events but makes the providers' calls exactly as without streaming: the text arrives once per step, or once at the end under `'after-middleware'`. The same applies when nothing would be streamed, with `textPolicy: 'after-middleware'` and no reasoning. `start.streaming` is then `false`.
  - **Output middleware.** `registerAfterGenerateMiddleware(name, middleware, { transformsOutput: false })` declares a middleware that does not change the reply text, so it does not hold text back. A strategy's own middleware counts through its `hasOutputMiddleware()`; a strategy without that method counts as having such middleware.
  - **Tool data.** A tool handler's `context.emit(name, data)` sends a `data` event between the tool's `tool-call` and `tool-result`. It is a no-op without `onEvent` and once the tool has finished. Data events are never saved to the chat history, are not held back by the text policy, and LOFT does not validate or log their payloads.
  - **Tracing.** When the provider streams, an LLM generation's completion start time is the time of its first output, not the time of the request.
  - **Usage.** `finish.usage` is the total over all LLM calls of the generation: token and cost fields summed, `model` and `finishReason` from the last call. `GenerateResult.messages.llmResponse.usage` stays the usage of the last call.
  - **Async callbacks.** An `onEvent` that returns a promise is not awaited; when the promise rejects, the rejection is logged with the event type only, like an exception the callback throws, and never becomes an unhandled rejection.
  - **Finish reason.** `step-finish` and `finish` carry `reason`, the same for every provider: OpenAI's `stop`, Anthropic's `end_turn` and `stop_sequence`, and Gemini's `STOP` are `stop`; the token limit, and Anthropic's `model_context_window_exceeded`, are `length`; content filters, safety stops and Anthropic's `refusal` are `content-filter`; tool calls are `tool-calls` (also a Gemini step that called tools and finished with `STOP`); Gemini's `MALFORMED_FUNCTION_CALL` is `error`; the loop limit (`max_loops_exceeded`), Anthropic's `pause_turn`, Gemini's `LANGUAGE` and any unknown value are `other`. `finishReason` keeps the provider's value.
  - **Abort reason.** `abort` carries `reason`: `timeout` when the call's signal was aborted by a timeout (a reason named `TimeoutError`, as `AbortSignal.timeout()` gives), `cancelled` otherwise.
  - **Retry-after.** A `rate_limited` error event carries `retryAfterMs` when the provider's error, or one of its causes, has a `retry-after-ms` or `retry-after` header.
  - **Unchanged.** The `GenerateResult`, what `save()` stores, and `shutdown()`, which still waits and neither aborts nor emits.

  The `generateStream` method of `LlmManager` is deprecated, with nothing removed now. Use `chat.generate({ onEvent })` instead. It is removed in the next major release.

  **Behaviour change for every caller, with or without `onEvent`:** a failed tracer flush after a successful generation no longer fails it. Before, `generate()` rejected with a `GenerateError` (status `ERROR`) when `tracer.flushAsync()` threw after the reply was generated, and a streamed call ended with an `error` event; now the failure is logged as a warning (the error's name and code, not its message), `finish` has already been sent, and `generate()` resolves with the result. The error path is unchanged: it still flushes after `error` or `abort` and logs a failed flush.

- 9da30fb: Tool handlers now get an optional second argument, `context`, with the `generate()` abort signal (`context.signal`) and an `emit(name, data)` function. `emit` is experimental: it sends a `data` event to a caller that streams the call with `onEvent`, and does nothing otherwise. Handlers that take only the arguments keep working. The abort signal also reaches MCP tool calls, both direct and through a tool interceptor's `executeToolFn`, each as a signal of the call's own that aborts with it. **Behaviour change:** aborting `generate()` during an MCP tool call now cancels that call: the MCP SDK sends the server a cancellation and rejects with an `McpError`, LOFT logs "Critical error during tool execution" at ERROR and adds an error tool result. Before, the MCP call ran to completion. The "Executing tool" debug log of `LlmManager` no longer includes the tool's arguments. MCP tool arguments are still logged at DEBUG by `MCPManager`.

### Patch Changes

- 11f6e42: The `generate()` trace and the `addMessages()` log no longer repeat the raw messages of a request:

  - The trace's `metadata.requestOptions` no longer has the `directMessages` and `augmentedContext` fields: it holds `directMessagesCount` and `augmentedContextCount` instead. If a dashboard or a trace query reads the removed fields, read the trace's `input`, which holds the request after the Input middleware (set when the call succeeds). Middleware spans still record the payload each middleware receives.
  - `addMessages()` logs the number of messages at trace level instead of the messages.

- 9da30fb: `LlmManager.generate` now runs every tool call through one internal helper; this is an internal refactor with no change in behaviour.

## 2.10.0

### Minor Changes

- ceee885: Graceful shutdown lets the requests in flight finish and can be bounded.

  - A request that is running when `shutdown()` starts now finishes. Before, the steps it started after that point (the LLM call of `generate()`) were rejected with `ShutdownError`, so the request failed.
  - `ChatConfig.shutdownTimeout` (milliseconds) limits how long `shutdown()` waits for the requests in flight; it then logs a warning and returns. Without it, `shutdown()` waits as long as they run, as before. A negative or non-finite value is rejected when the chat is created. The wait no longer polls every 100 ms.
  - `LOFT.shutdown()` shuts the tracer down as its last step. `LoftConstructor.gracefulShutdown()`, which did that, is deprecated; calling it after `shutdown()` still works.
  - A call started from a finished operation without being awaited is rejected with `ShutdownError` after `shutdown()`, like any new call.
  - When stopping the LLM strategies throws, `LOFT.shutdown()` logs the error and still shuts the tracer down.
  - The manifest error file also holds the cause of a load error, such as the JSON parse error.

- 5e97c38: `ChatConfig.historyLimit` bounds how much history a request loads. A request then loads only that many of the latest messages of the session, still in chronological order, instead of the whole history; the default stays all of it. A limited history does not start with tool results whose tool call was cut off.

  - `Repository.ChatHistory.getMessages()` takes an optional `{ limit }`. The PostgreSQL repository reads only the latest messages; a custom repository that ignores it still works, as the chat history manager keeps the latest messages itself.
  - `getChatHistory()` still returns the whole history.
  - A `historyLimit` that is not an integer of 0 or more is rejected with a `TypeError`.
  - Without `historyLimit`, the chat history manager is called with the session id only, as before.

### Patch Changes

- b009ff6: Drop the `uuid` dependency: ids come from `node:crypto` `randomUUID`, and the `UUID` schema accepts the same values as before. `loft-definitions` updates `pino` from 8 to 10.
- f844df9: Errors keep their cause instead of losing it.

  - `FsRepository` throws an `Error` with the file system error as its `cause`, not a string, and no longer logs it first; `ManifestManager` logs it once.
  - `HttpCallManagerStrategy` keeps the last failure as the `cause` of "CallManager doesn't work" and "stream call doesn't work".

- 839476f: Add `SessionNotFoundError`, so an application can tell a missing session apart from a database or provider failure, for example to answer 404.

  - `@moc-global/loft-definitions` exports it. It extends `ChatError` and has the `sessionId`, or the `externalKey` the session was looked up by. A custom `Repository.Session` should throw it from `getById()`, `getByExternalKey()`, `updateById()` and `deleteById()`.
  - The PostgreSQL session repository throws it instead of a plain `Error` (or Kysely's `NoResultError` from `updateById()`). It reaches the caller unchanged from `generate()`, `addMessages()`, `getSessionById()`, `getSessionByExternalKey()`, `updateSessionSettings()` and `deleteSession()`. The message stays `Session with id <id> not found`; for an external key it now shows the key as JSON instead of `[object Object]`.
  - `updateSessionSettings()` throws it too when a custom repository returns nothing for the session.

- 89ba02e: `LoftConstructor.validateManifest()` now rejects when the manifests cannot be loaded or are invalid, as its docs say. It resolved in every case: it called `ManifestManager.updateCache()`, which logs a failed load and keeps the stale cache. `ManifestManager` gets a `validate()` method that reports the error. `Interface.ManifestManager` declares it as optional, and `validateManifest()` falls back to `updateCache()` for a manager without it. Request handling keeps using the stale cache as before.

## 2.9.0

### Minor Changes

- 19ede7d: Cancel timed-out agent calls and fix Focus completion.

  - Cancellation: `generate()` accepts an optional `signal` (AbortSignal). It is passed through the LLM manager and call manager to the Anthropic, OpenAI, Azure OpenAI and Gemini SDK calls, and the tool loop stops once the signal aborts. Aborted calls are not retried.
  - `loft-agents`: a node timeout now aborts the node's LLM call before any retry. `Agent.Node.run()` receives `options.signal`, `Orchestrator.run()` and `runFrom()` accept `{ signal }` to cancel a whole run, and retries stop once the run is cancelled.
  - `loft-agents`: `LoftAgentNode` takes a `focusName` option naming the registered Focus it collects. It no longer uses its node name as the Focus name; without `focusName` the session's Focus applies.
  - Focus: a completed Focus returns its values once in `focusStatus.filled` and then clears them from the focus state store, so it does not complete again with stale data.
  - Focus: completing a per-call Focus no longer deactivates a different session-level Focus.
  - Focus: collected values and shared context are written into prompts as escaped JSON in delimited blocks (`toPromptData`), with Focus string values capped at 500 characters, so user input cannot add prompt instructions.

- 19ede7d: Declare the libraries LOFT shares with your code as peer dependencies, and fill in the package metadata.

  - inversify, reflect-metadata, zod, the MCP SDK, `@moc-global/loft-definitions` (and `@moc-global/loft` for `loft-agents`) and the SDKs that appear in the public types (`openai`, `@anthropic-ai/sdk`, `@google/genai`, `@aws-sdk/client-sqs`) are peer dependencies instead of dependencies, so your project and LOFT use one copy of each. A custom constructor written against your own inversify now compiles. LOFT needs inversify 6 and zod 3. npm 7 or later and pnpm install missing peers on their own; with Yarn, add them to your dependencies.
  - `langfuse` is an optional peer dependency of `@moc-global/loft`, loaded only when a `LangfuseTracer` is created. If you use `LangfuseTracer`, install `langfuse` yourself; without it, the constructor throws an error that says so.
  - zod is no longer pinned to exactly 3.25.67; any zod 3 from 3.25.67 on works.
  - Every package declares the MIT license, a description, keywords, homepage, issue tracker and the `MoC-OSS/LOFT` repository with its directory.

- 19ede7d: Type AfterGenerate middleware with the payload it receives.

  `registerAfterGenerateMiddleware()` declared the payload as `Strategy.LLM.UnifiedLLMResponse`, but the middleware receives a `Chat.GenerateResultMessages` (`llmResponse`, `directMessages`, `augmentedContext`, `save()`). Code that read, for example, `payload.usage` compiled and got `undefined`; it now fails to compile and should read `payload.llmResponse.usage`. Middleware typed as `StandardMiddleware<ContextInterface, Strategy.LLM.UnifiedLLMResponse>` should change to `StandardMiddleware<ContextInterface, Chat.GenerateResultMessages>`.

### Patch Changes

- 19ede7d: Send the text of `ctx.aiTask(llmName, manifestName, text)` as a user message.

  It was sent as a system message. The Anthropic strategy sends only the manifest's system message and skips system messages in the conversation, so an AI task with text input reached Anthropic with no message at all, and the request failed. OpenAI and Gemini now also receive the text as a user message. AI tasks called with an array of messages are unchanged.

- 19ede7d: Update dependencies to fix security advisories.

  - `@modelcontextprotocol/sdk`: `^1.26.0` -> `^1.31.0`
  - `axios`: `^1.13.5` -> `^1.20.0`
  - `fast-copy`: `^3.0.2` -> `^3.1.0`
  - `kysely`: `^0.27.3` -> `^0.28.17`
  - `@aws-sdk/client-s3` and `@aws-sdk/client-sqs`: -> `^3.1140.0` (pulls a patched `fast-xml-parser`)

- 19ede7d: Send the model only the current Focus prompt.

  Each turn of a session with Focus adds a system message with the Focus instructions and the fields collected so far, and `result.messages.save()` stores it. Later turns sent every stored copy along with the new one, so the model saw outdated statuses. Stored Focus prompts are now left out of the history sent to the model, like the messages agents exchange; the history itself is unchanged.

- 19ede7d: `GenerateError` carries the original error as `cause`.

  When `generate()` failed on an error that was not already a `GenerateError`, such as a provider error or a failing middleware, the wrapper left `cause` empty and put the original error only in `details`, so the documented `error.cause` and the `Caused by:` stack were missing. `cause` now holds the original error, and `details` still does. The message is the original error's message, without the doubled `Error:` prefix.

  The stack of `GenerateError`, `ShutdownError` and the other `ChatError` subclasses now ends with the cause's stack after `Caused by:`, as documented; each subclass captured its stack again after `ChatError` had added the cause, which removed it.

- 19ede7d: `LangfuseTracer` works in bundled applications.

  `LangfuseTracer` loads the optional `langfuse` package when it is created, in a way that esbuild and webpack cannot see, so a bundled application failed with "LangfuseTracer needs the langfuse package". Pass the class you import, `new LangfuseTracer(config, { Langfuse })`, and the bundler includes it. An application that a bundler turned from the ES module build into CommonJS, as esbuild does for AWS Lambda, no longer fails when it creates the tracer; without the class it gets the same hint. The install hint now appears only when `langfuse` itself is missing, not when one of its own dependencies is.

- 19ede7d: Stop warning at startup about manifest entries that are not validated yet.

  The manifest loads before the LLM strategies register, so every application logged a warning per LLM, "no schema registered yet - skipping validation", although each strategy validates its entries when it registers. The message is now logged at debug level and says that validation follows.

- 19ede7d: Accept MCP servers that offer no tools.

  `useMcpClient()` called `tools/list` on every server, and a server without the tools capability, for example one that only serves resources, answers that with "Method not found", so its registration failed. LOFT now checks the server's capabilities and registers such a server with no tools. A client that is not connected still fails to register, with the SDK's "Not connected" error.

- 19ede7d: Declare the supported Node.js versions: `engines.node` is `>=22`. CI tests Node 22, 24 and 26.
- 19ede7d: Keep each message's `ctx` when patching chat history.

  `context.chatHistory.patchMessages()` lost the `ctx` of every patched message unless the patch itself set `ctx`, because the messages were copied with a spread that skips the `ctx` getter. The copy now takes each message field explicitly. This only affects applications that pass a `ChatHistoryPatcher` repository to `ChatConstructor`.

- 19ede7d: Fix the ES module builds, and publish only the built code.

  - `loft-llm-call-manager` works when imported as an ES module: `GenerateCallManager` and `GenerateWithQueueManager` no longer throw `PQueue is not a constructor`.
  - The Postgres repositories load as ES modules, and `runSessionPgMigrations` and `runChatHistoryPgMigrations` find their migrations from both builds. Their library entry no longer bundles the migration CLI (yargs, dotenv). `SessionMigrationOptions` and `ChatHistoryMigrationOptions` are exported, and `databaseSsl` is optional (default false).
  - Each package is built from its `index.ts` into one bundle per format, and the tarball holds only `lib` (and `bin` for `loft-definitions`), so tests, sources and `tsconfig.json` are no longer published. `@moc-global/loft` unpacks to 1.0 MB instead of 6.5 MB. Only the package root was ever exported, so imports do not change.
  - Unused runtime dependencies are removed: `axios`, `fast-copy` and `openai` from `loft`; `axios`, `uuid` and `zod-to-json-schema` from `loft-openai-strategy`; `uuid` from the Gemini, LLM call manager and Postgres packages. `zod` moves to `devDependencies` in the S3, GCP, Azure, SQS and LLM call manager packages, which use it only in tests. Code that imported one of these through LOFT must declare it itself.

- 19ede7d: Ship ES module types and the MIT license file.

  - Code that imports a package now gets ES module type declarations (`.d.mts`) that match the `.mjs` build; code that requires it keeps the CommonJS declarations (`.d.ts`). Before, both got the CommonJS declarations, so TypeScript with `moduleResolution: node16` or `nodenext` typed ES module imports as CommonJS. `package.json` is exported too.
  - Every package ships the MIT `LICENSE`. `@moc-global/loft-definitions` also ships a `NOTICE` for the types it copies from the MCP TypeScript SDK (MIT, Anthropic, PBC).

- 19ede7d: Fix parallel tool calls, tool errors and silent failures.

  - Anthropic: the results of parallel tool calls go back in one user message, so the second and later results are no longer dropped. A failed tool result is sent with `is_error`.
  - OpenAI: each tool result becomes its own `tool` message, and a result without text is sent as empty text instead of being dropped.
  - Gemini: a failed tool result is sent under the `error` key.
  - Tool messages from parallel calls are saved to chat history: the integrity check counts tool calls and tool results, not messages.
  - MCP: the text of a tool that reports `isError` reaches the model, and an empty successful result is a success with empty content.
  - Chat history rejects a message whose `sessionId` differs from the session it is added to.
  - `LlmManager.getPrompt(ctx, promptName, llmName)` now takes its arguments in that order, and `ManifestManager.getPrompt` reads `prompts[promptName][llmName]`. `ctx.getPrompt` already worked; code that called `LlmManager.getPrompt` directly must swap its last two arguments.
  - `SQSStrategy.publish` waits for the send and rejects when it fails. A failed queued task is logged instead of crashing the process with an unhandled rejection.
  - `LoftConstructor.validateManifest()` returns the promise of the manifest check.
  - The migration CLIs exit with code 1 when a migration fails.
  - Postgres migrations use the `schemaName` passed to `runSessionPgMigrations` and `runChatHistoryPgMigrations` instead of reading `DATABASE_*_SCHEMA_NAME` and a `.env` file. Behaviour change: the schema name must be lower-case letters, digits and underscores (at most 63), and other names are rejected before anything runs. Mixed-case or hyphenated names already failed in the chat history migrations, which pasted the name into the SQL unquoted. A missing schema now throws instead of exiting the process. The migration CLIs still read the schema name from their env file.
  - Both Postgres packages declare `dotenv`, which their migration CLI loads.

- 19ede7d: Stop background timers on shutdown, keep chat content out of default logs, and fix `to-current-lib-version`.

  - The migration command `to-current-lib-version` migrates to the newest migration at or below the library version (library 1.2.5 runs migrations up to 1.2.0). It used to fail because no migration is named after the library version.
  - The refill timer of `LlmTokenRateLimiter` no longer keeps the process alive. `LlmTokenRateLimiter` and `ExponentialBackoffPoller` have a `stop()`; the poller still keeps a queue worker alive until it is stopped. `LOFT.shutdown()` calls the new optional `stop()` of each registered LLM strategy, which stops the rate limiter of its call manager and the queue poller of `GenerateWithQueueManager`. A worker that runs `GenerateWithQueueManager` without LOFT calls its `stop()` to exit.
  - Tool arguments, tool results and user messages are no longer logged at INFO, WARN or ERROR; they are logged at DEBUG. `PinoLoggerStrategy` drops the request (body and headers) of HTTP client errors and redacts credential fields and headers. The configuration reference lists what each log level contains.
  - A tool error that is not a string reaches the model as JSON or as the error's message, instead of `[object Object]`.
  - The Postgres health checks bind the schema name as a query parameter instead of putting it in the SQL text.
  - The compiled unit tests are no longer built into `lib` of the Anthropic, Gemini, LLM call manager and chat history packages.

- Updated dependencies [19ede7d]
- Updated dependencies [19ede7d]
- Updated dependencies [19ede7d]
- Updated dependencies [f5aa906]
- Updated dependencies [19ede7d]
- Updated dependencies [19ede7d]
- Updated dependencies [19ede7d]
- Updated dependencies [19ede7d]
- Updated dependencies [19ede7d]
- Updated dependencies [19ede7d]
- Updated dependencies [19ede7d]
- Updated dependencies [19ede7d]
- Updated dependencies [19ede7d]
  - @moc-global/loft-definitions@1.8.0

## 2.8.0

### Minor Changes

- 151b683: Extract Focus engine from loft-agents to core loft package; make Focus a LOFT-level capability

  **Phase A — Extract Focus to core:**
  - **@moc-global/loft** (minor): Add Focus engine — `computeFocusStatus`, `generateFocusPrompt`, `generateFocusTools`, `InMemoryFocusStateStore`, `coerceValue`, `validateField`, and tool handlers. Focus can now be used standalone without the orchestrator.
  - **@moc-global/loft-definitions** (minor): Add optional `focus?: Agent.FocusStateStore` to `Repository.Session`. Add `focusAgent?: string` to `Chat.GenerateOptions` and `focusStatus?: Agent.FocusStatus` to `Chat.GenerateResult`. Add `FocusRegistry` DI symbol.
  - **@moc-global/loft-session-pg-repository** (patch): Add lazy `focus` accessor to `SessionRepository` that returns `FocusStateStorePg` instance.

  **Phase B — Focus as LOFT-level capability:**
  - **@moc-global/loft** (minor): Add `FocusRegistry` class and `LOFT.registerFocus()`/`LOFT.getFocus()` methods. Focus prompt injection, tool generation, and status computation now run inside `BaseLoftChat.generate()` when `focusAgent` option is provided. Zero overhead when not used.
  - **@moc-global/loft-agents** (major): **BREAKING** — `LoftAgentNode` constructor no longer accepts `focus: Agent.Focus`. Use `focusAgent: string` (references registered Focus config) and `onFocusComplete: Agent.FocusAction` (transition routing). All focus logic removed from agent — delegated to `generate()`. Focus symbols re-exported from `@moc-global/loft` for backward compatibility.

  **Phase C — Session-level Focus binding:**
  - **@moc-global/loft-definitions** (minor): Add `focusAgent?: string | null` to `CreateSession` schema and `SessionUpdateData`. `GenerateOptions.focusAgent` supports `null` to explicitly disable session-level Focus for a single call.
  - **@moc-global/loft** (minor): `BaseLoftChat.generate()` resolves `focusAgent` with priority: per-call option > `null` disables > session fallback > none. Auto-deactivates session-level Focus when all fields are collected (`focusStatus.ready === true`).
  - **@moc-global/loft-session-pg-repository** (patch): Add `focus_agent` column via migration 1.2.0. `SessionRepository` persists and reads `focusAgent` on session create/update.
  - **@moc-global/loft-agents** (major): **BREAKING** — `LoftAgentNode` constructor no longer accepts `focusAgent: string`. Focus is now session-level — set `focusAgent` at session creation time. `onFocusComplete` remains for agent-graph transition routing.

### Patch Changes

- 7db5371: Raise the minimum `@modelcontextprotocol/sdk` to `^1.26.0`, which fixes GHSA-345p-7cg4-v4c7: sharing an MCP server or transport instance could leak response data between clients. Loft itself uses the SDK client, so the fix matters if you share an `McpServer` or transport instance, for example through the `McpServer` and `InMemoryTransport` re-exports from `@moc-global/loft-definitions`. No API changes in Loft.
- Updated dependencies [151b683]
- Updated dependencies [7db5371]
  - @moc-global/loft-definitions@1.7.0

## 2.7.3

### Patch Changes

- c949af5: Simplify Logger API (remove DI injection, buffering), delete unused SMG code, fix MCP SDK vulnerability (upgrade to 1.25.0, pin Zod to 3.25.67)
- Updated dependencies [c949af5]
  - @moc-global/loft-definitions@1.6.3

## 2.7.2

### Patch Changes

- e2638a1: Fix Anthropic strategy to only include citations in ctx when defined
- Updated dependencies [e2638a1]
  - @moc-global/loft-definitions@1.6.2

## 2.7.1

### Patch Changes

- 812b01c: Added Jest ESM troubleshooting docs for Langfuse dynamic import error and made ctx field in Message schema default to {}.
- Updated dependencies [812b01c]
  - @moc-global/loft-definitions@1.6.1

## 2.7.0

### Minor Changes

- 5157af8: Add comprehensive Langfuse tracing, refactor ManifestManager to instance-based caching with recovery mechanisms (BREAKING: async LLM registration), fix parallel test execution with OS-based port allocation, remove Logger DI dependency.

### Patch Changes

- b4b2015: Refactor Logger to remove DI dependency, fix empty arrays in logs, and add LOFT branding with [LOFT] prefix in formatted output
- 26aff62: Add new Gemini strategy package with support for Vertex AI (GCP) and Google AI Studio authentication modes, including message adapters and MCP tool support
- Updated dependencies [b4b2015]
- Updated dependencies [5157af8]
- Updated dependencies [26aff62]
  - @moc-global/loft-definitions@1.6.0

## 2.6.0

### Minor Changes

- 17ee776: ToolHandler → ToolInterceptor with enhanced params (callLimits, toolClients) and destructured callback signature
- 7620009: implement LlmContextWindowCropper for safe chat history management

### Patch Changes

- a06ad5a: implement preventGenerate functionality in ToolInterceptor
- 9e62e13: update docs and enhance MCP client metadata handling
- 19de13d: enhance MCP client integration with metadata support and add client filtering for tool execution
- Updated dependencies [a06ad5a]
- Updated dependencies [9e62e13]
- Updated dependencies [19de13d]
- Updated dependencies [17ee776]
- Updated dependencies [7620009]
  - @moc-global/loft-definitions@1.5.0

## 2.5.12

### Patch Changes

- ca1ef1d: added MCP ToolHandlerManager Component
- Updated dependencies [ca1ef1d]
  - @moc-global/loft-definitions@1.4.8

## 2.5.11

### Patch Changes

- f57b012: configured test running in repository root, fixed test errors, added husky for monorepo
- 75930b0: added Gracefully crop ChatHistory to maintain tool chain integrity

## 2.5.10

### Patch Changes

- bbc892f: fixed publish errors

## 2.5.9

### Patch Changes

- 2df2d1f: integration tests for the MCP host, covering cases like missing tools, disconnections, and invalid responses.
- dc8aabb: Replaced PGLite instead Postgresql + Docker for tests
- b84246b: reorganize tool validation logic and improve logging in LlmManager

## 2.5.8

### Patch Changes

- 608d096: moved @moc-global/loft-base-tsconfig to monorepo pnpm root devDependencies
- Updated dependencies [608d096]
  - @moc-global/loft-definitions@1.4.7

## 2.5.7

### Patch Changes

- 4b059fd: migrated monorepo to PNPM, updated packages, upgraded LOFT Multi Part Content structure, updated MPC SDK and Structures, fixed types in LLM Strategies, added tool for sync versions across all packages, fixed a lot of monorepo problems, tests etc...
- 05efbbd: migrate from base-tsconfig to loft-base-tsconfig across all packages and include loft-base-tsconfig package to publish
- Updated dependencies [4b059fd]
- Updated dependencies [05efbbd]
  - @moc-global/loft-definitions@1.4.6

## 2.5.6

### Patch Changes

- 4b059fd: migrated monorepo to PNPM, updated packages, upgraded LOFT Multi Part Content structure, updated MPC SDK and Structures, fixed types in LLM Strategies, added tool for sync versions across all packages, fixed a lot of monorepo problems, tests etc...
- Updated dependencies [4b059fd]
  - @moc-global/loft-definitions@1.4.5

## 2.5.5

### Patch Changes

- d02d0a5: Initial release
- Updated dependencies [d02d0a5]
  - @moc-global/loft-definitions@1.4.4
