# @moc-global/loft-definitions

## 2.0.0

### Major Changes

- bc747ee: Move from zod 3 to zod 4. The `zod` peer dependency is now `^4.6.6`, the first version without [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), a memory exhaustion while validating large arrays that affects every zod 3 release. zod 3 is no longer supported.

  To upgrade:

  - Install zod 4: `npm install zod@^4.6.6`.
  - Build the schemas you pass to LOFT with zod 4, such as the one given to `useLlmManifestSchema()` or returned by a custom strategy's `generateRequestValidationSchema()`.
  - Code that uses the schemas LOFT exports (`Schema.*`) with zod 3 APIs needs the zod 4 changes, see the [zod 4 migration guide](https://zod.dev/v4/changelog). Validation error messages read differently, for example `Invalid input: expected string, received number`.
  - `@moc-global/loft-openai-strategy` needs openai 7 (`^7.34.0`). openai 4 is no longer supported: it has had no release since May 2025, and it declares zod 3 as a peer, so npm refuses to install it next to zod 4. See the [openai-node migration guide](https://github.com/openai/openai-node/blob/main/MIGRATION.md) for the changes between the SDK majors.

## 1.10.0

### Minor Changes

- 9da30fb: The rate limiter interface, `Strategy.LLM.LlmTokenRateLimiter`, gains an optional `acquire(tokens, signal?)`, which waits until the tokens and one request are available and takes both in one synchronous step, checking again after every wait; when `signal` aborts during a wait, it rejects at once and takes nothing. A rate limiter without `acquire` is still used through `awaitBeforeCall`, `setUsedTokens` and `setUsedRequest`. The interface now documents that `setUsedTokens` takes a negative value to refund tokens.
- 9da30fb: Adds the experimental types for streaming a chat reply. `Strategy.LLM.LlmStreamEvent`, `LlmStreamSink` and `StreamUsage` describe what a provider reports while it streams, and `CallOptions.onEvent` lets LOFT pass a sink to a provider. `Chat.ChatStreamEvent`, `ChatStreamEventBase`, `ChatStreamErrorCode` and `StreamOptions` describe the events of a streamed `generate()` call, and `Chat.GenerateOptions` gets the optional `onEvent` and `streamOptions`. Existing code is unaffected.

  Middleware can now declare that it does not change the reply text: `registerAfterGenerateMiddleware`, `AbstractLoftLLM.useMiddleware` and `MiddlewareManager.use` take an optional `{ transformsOutput?: boolean }` (default `true`, the current behaviour). `MiddlewareManager` exposes `transformingCount` and `transformingNames`, and `LoftLLM` gets the optional `hasOutputMiddleware()`, which `AbstractLoftLLM` implements.

  Adds `StreamIdleTimeoutError`, for a model stream that stays silent for too long. The last parameter of `Interface.LlmManager.generate` is now `Interface.LlmGenerateOptions`, which extends `CallOptions`. Both it and `Chat.GenerationEventSink` are internal and may change in any release.

  Deprecated, with nothing removed now: `Strategy.LLM.LLMApi.generateStream` and `extractContentFromChunk`, `Strategy.CallManager.streamCall` (and the `streamCall` methods of the call manager strategies), `Strategy.LLM.LoftLLM.generateStream`, `Strategy.LLM.UnifiedLLMStream`, `Strategy.LLM.UnifiedLLMChunkResponse`, `Interface.LlmManager.generateStream` and `Chat.Status.SUCCESS_STREAM`. Use `chat.generate({ onEvent })` instead. They stay on the interfaces as required members and are removed in the next major release.

  `step-finish` and `finish` events carry `reason`, the finish reason normalized across providers (`Chat.ChatFinishReason`: `'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'`, a union that may gain values), beside `finishReason`, which stays the provider's raw value. The `abort` event carries `reason: 'timeout' | 'cancelled'`, and an `error` event with `code: 'rate_limited'` may carry `retryAfterMs`.

- 9da30fb: New `Strategy.LLM.LoftFinishReason` enum names the finish reasons LOFT sets on a response that no provider call produced: `interceptor_override` (a tool interceptor replaced the reply), `middleware_override` (BeforeGenerate middleware prevented the generation) and `max_loops_exceeded` (the tool loop reached its limit). The values are the strings LOFT already wrote to `usage.finishReason`; nothing changes for code that compares against them.
- 9da30fb: `isRetryableError` now also treats an error without an HTTP status as retryable when its `type` or `error.type` is `overloaded_error`, `api_error` (Anthropic) or `server_error` (OpenAI), as the provider errors that arrive in the middle of a stream do. An error with a status is still judged by the status alone.

  New `providerErrorSummary(error)` returns what a log may say about a failed provider request: the error's class name, HTTP `status`, `type` and `code`, never its message or body. The OpenAI, Anthropic and Gemini strategies use it for their streamed-request logs.

  New `guardedStreamSink(onEvent, warn)` wraps a provider strategy's stream sink so a sink that throws cannot break the stream; only its first failure is reported, with the event type only. The three strategies use it.

- 9da30fb: The tool handler type takes an optional second argument, `context` (`Chat.AdditionalToolContext`), with the `generate()` abort signal (`context.signal`) and an `emit(name, data)` function. `emit` is experimental. The handler is declared method-style, so handlers that take only the arguments, or that declare a required `context`, still type-check.

## 1.9.0

### Minor Changes

- 5e97c38: `ChatConfig.historyLimit` bounds how much history a request loads. A request then loads only that many of the latest messages of the session, still in chronological order, instead of the whole history; the default stays all of it. A limited history does not start with tool results whose tool call was cut off.

  - `Repository.ChatHistory.getMessages()` takes an optional `{ limit }`. The PostgreSQL repository reads only the latest messages; a custom repository that ignores it still works, as the chat history manager keeps the latest messages itself.
  - `getChatHistory()` still returns the whole history.
  - A `historyLimit` that is not an integer of 0 or more is rejected with a `TypeError`.
  - Without `historyLimit`, the chat history manager is called with the session id only, as before.

- 5e97c38: The call managers retry only what can succeed on a new attempt, with backoff.

  - `GenerateCallManager` and `HttpCallManagerStrategy` retry 408, 429 and 5xx responses and network failures, and no longer retry a 400, 401 or 404, or any other error.
  - The wait doubles with each attempt, from `retryDelay`, between half and all of it at random (jitter), at most 60 s. A `Retry-After` (or `retry-after-ms`) header from the provider sets the wait instead.
  - `HttpCallManagerStrategy` waited nothing between attempts; it now takes an optional `retryDelay` (default 500 ms). `call()` and `streamCall()` throw the axios error itself for a response that is not retried (a 400, 401 or 404, say), instead of `Error("CallManager doesn't work")`; that error is still thrown, with the last error as its `cause`, when the retries run out.
  - `GenerateWithStreamManager` follows the same policy instead of retrying every error after a fixed delay.
  - The connection and timeout errors of the OpenAI and Anthropic SDKs are retried; they are recognised by their class, as their `name` is `Error`.
  - Aborting the call's `signal` ends the wait before a retry. An invalid `retryDelay` (NaN, say) counts as 0 instead of replacing the provider error.
  - `@moc-global/loft-definitions` exports the policy: `isRetryableError()`, `retryDelayMs()`, `retryAfterMs()`, `errorStatus()` and `waitForRetry()`.

- 839476f: Add `SessionNotFoundError`, so an application can tell a missing session apart from a database or provider failure, for example to answer 404.

  - `@moc-global/loft-definitions` exports it. It extends `ChatError` and has the `sessionId`, or the `externalKey` the session was looked up by. A custom `Repository.Session` should throw it from `getById()`, `getByExternalKey()`, `updateById()` and `deleteById()`.
  - The PostgreSQL session repository throws it instead of a plain `Error` (or Kysely's `NoResultError` from `updateById()`). It reaches the caller unchanged from `generate()`, `addMessages()`, `getSessionById()`, `getSessionByExternalKey()`, `updateSessionSettings()` and `deleteSession()`. The message stays `Session with id <id> not found`; for an external key it now shows the key as JSON instead of `[object Object]`.
  - `updateSessionSettings()` throws it too when a custom repository returns nothing for the session.

- 89ba02e: `LoftConstructor.validateManifest()` now rejects when the manifests cannot be loaded or are invalid, as its docs say. It resolved in every case: it called `ManifestManager.updateCache()`, which logs a failed load and keeps the stale cache. `ManifestManager` gets a `validate()` method that reports the error. `Interface.ManifestManager` declares it as optional, and `validateManifest()` falls back to `updateCache()` for a manager without it. Request handling keeps using the stale cache as before.

### Patch Changes

- b009ff6: Drop the `uuid` dependency: ids come from `node:crypto` `randomUUID`, and the `UUID` schema accepts the same values as before. `loft-definitions` updates `pino` from 8 to 10.
- f844df9: Errors keep their cause instead of losing it.

  - `FsRepository` throws an `Error` with the file system error as its `cause`, not a string, and no longer logs it first; `ManifestManager` logs it once.
  - `HttpCallManagerStrategy` keeps the last failure as the `cause` of "CallManager doesn't work" and "stream call doesn't work".

- fd8dad3: The middleware chain now copies the payload before the first middleware as well, not only between middlewares. A middleware that changed its input object used to change the caller's object too; code that relied on that by accident now sees the caller's payload unchanged.

## 1.8.0

### Minor Changes

- 19ede7d: Cancel timed-out agent calls and fix Focus completion.

  - Cancellation: `generate()` accepts an optional `signal` (AbortSignal). It is passed through the LLM manager and call manager to the Anthropic, OpenAI, Azure OpenAI and Gemini SDK calls, and the tool loop stops once the signal aborts. Aborted calls are not retried.
  - `loft-agents`: a node timeout now aborts the node's LLM call before any retry. `Agent.Node.run()` receives `options.signal`, `Orchestrator.run()` and `runFrom()` accept `{ signal }` to cancel a whole run, and retries stop once the run is cancelled.
  - `loft-agents`: `LoftAgentNode` takes a `focusName` option naming the registered Focus it collects. It no longer uses its node name as the Focus name; without `focusName` the session's Focus applies.
  - Focus: a completed Focus returns its values once in `focusStatus.filled` and then clears them from the focus state store, so it does not complete again with stale data.
  - Focus: completing a per-call Focus no longer deactivates a different session-level Focus.
  - Focus: collected values and shared context are written into prompts as escaped JSON in delimited blocks (`toPromptData`), with Focus string values capped at 500 characters, so user input cannot add prompt instructions.

- f5aa906: Keep Gemini 3 thought signatures, so tool calls work with Gemini 3.

  Gemini 3 models sign their thinking and reject a request whose earlier function calls come back without their signatures (400 "Function call is missing a thought_signature"). The strategy dropped the signatures, so every tool loop with a Gemini 3 model failed on its second request. It now keeps each signature in the `_meta` of the content part and sends it back. A turn whose function calls have no signature, such as one saved by an older LOFT version or made by another model of the session, is sent with Gemini's documented stand-in `skip_thought_signature_validator`. A `tool_call` content part takes an optional `_meta`, as the other content parts do; it stays outside `params`, which go to the MCP server. Thought summaries are no longer added to the answer text, in streaming too.

- 19ede7d: Declare the libraries LOFT shares with your code as peer dependencies, and fill in the package metadata.

  - inversify, reflect-metadata, zod, the MCP SDK, `@moc-global/loft-definitions` (and `@moc-global/loft` for `loft-agents`) and the SDKs that appear in the public types (`openai`, `@anthropic-ai/sdk`, `@google/genai`, `@aws-sdk/client-sqs`) are peer dependencies instead of dependencies, so your project and LOFT use one copy of each. A custom constructor written against your own inversify now compiles. LOFT needs inversify 6 and zod 3. npm 7 or later and pnpm install missing peers on their own; with Yarn, add them to your dependencies.
  - `langfuse` is an optional peer dependency of `@moc-global/loft`, loaded only when a `LangfuseTracer` is created. If you use `LangfuseTracer`, install `langfuse` yourself; without it, the constructor throws an error that says so.
  - zod is no longer pinned to exactly 3.25.67; any zod 3 from 3.25.67 on works.
  - Every package declares the MIT license, a description, keywords, homepage, issue tracker and the `MoC-OSS/LOFT` repository with its directory.

- 19ede7d: Type AfterGenerate middleware with the payload it receives.

  `registerAfterGenerateMiddleware()` declared the payload as `Strategy.LLM.UnifiedLLMResponse`, but the middleware receives a `Chat.GenerateResultMessages` (`llmResponse`, `directMessages`, `augmentedContext`, `save()`). Code that read, for example, `payload.usage` compiled and got `undefined`; it now fails to compile and should read `payload.llmResponse.usage`. Middleware typed as `StandardMiddleware<ContextInterface, Strategy.LLM.UnifiedLLMResponse>` should change to `StandardMiddleware<ContextInterface, Chat.GenerateResultMessages>`.

### Patch Changes

- 19ede7d: Accept lists and `null` in `ctx`.

  The `ctx` of sessions and messages accepted only strings, numbers, booleans and nested objects, so a `ctx` holding a list or `null` failed validation with "Expected an unknown object". This broke `@moc-global/loft-agents` runs in which a Focus completed inside the run: the next node received the Focus status, whose `missing` field is a list, and rejected it. `ctx` now accepts any JSON value inside the object.

- 19ede7d: Update dependencies to fix security advisories.

  - `@modelcontextprotocol/sdk`: `^1.26.0` -> `^1.31.0`
  - `axios`: `^1.13.5` -> `^1.20.0`
  - `fast-copy`: `^3.0.2` -> `^3.1.0`
  - `kysely`: `^0.27.3` -> `^0.28.17`
  - `@aws-sdk/client-s3` and `@aws-sdk/client-sqs`: -> `^3.1140.0` (pulls a patched `fast-xml-parser`)

- 19ede7d: `GenerateError` carries the original error as `cause`.

  When `generate()` failed on an error that was not already a `GenerateError`, such as a provider error or a failing middleware, the wrapper left `cause` empty and put the original error only in `details`, so the documented `error.cause` and the `Caused by:` stack were missing. `cause` now holds the original error, and `details` still does. The message is the original error's message, without the doubled `Error:` prefix.

  The stack of `GenerateError`, `ShutdownError` and the other `ChatError` subclasses now ends with the cause's stack after `Caused by:`, as documented; each subclass captured its stack again after `ChatError` had added the cause, which removed it.

- 19ede7d: Declare the supported Node.js versions: `engines.node` is `>=22`. CI tests Node 22, 24 and 26.
- 19ede7d: Generate tool-call ids with `node:crypto` instead of `Math.random()`.

  `generateToolCallId()` keeps its `{toolName}:::{20 lowercase letters}` format. The OpenAI strategy names a tool call that has no `callId` `call_<uuid>` instead of `call_<9 base-36 characters>`. Also removes a statement without effect from `ChatHistoryRepositoryConstructor.initializeContainer()` and a branch of `deepMerge()` that copied nested arrays element by element; nested arrays are still copied shallowly.

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

## 1.7.0

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

## 1.6.3

### Patch Changes

- c949af5: Simplify Logger API (remove DI injection, buffering), delete unused SMG code, fix MCP SDK vulnerability (upgrade to 1.25.0, pin Zod to 3.25.67)

## 1.6.2

### Patch Changes

- e2638a1: Fix Anthropic strategy to only include citations in ctx when defined

## 1.6.1

### Patch Changes

- 812b01c: Added Jest ESM troubleshooting docs for Langfuse dynamic import error and made ctx field in Message schema default to {}.

## 1.6.0

### Minor Changes

- 5157af8: Add comprehensive Langfuse tracing, refactor ManifestManager to instance-based caching with recovery mechanisms (BREAKING: async LLM registration), fix parallel test execution with OS-based port allocation, remove Logger DI dependency.

### Patch Changes

- b4b2015: Refactor Logger to remove DI dependency, fix empty arrays in logs, and add LOFT branding with [LOFT] prefix in formatted output
- 26aff62: Add new Gemini strategy package with support for Vertex AI (GCP) and Google AI Studio authentication modes, including message adapters and MCP tool support

## 1.5.0

### Minor Changes

- 17ee776: ToolHandler → ToolInterceptor with enhanced params (callLimits, toolClients) and destructured callback signature
- 7620009: implement LlmContextWindowCropper for safe chat history management

### Patch Changes

- a06ad5a: implement preventGenerate functionality in ToolInterceptor
- 9e62e13: update docs and enhance MCP client metadata handling
- 19de13d: enhance MCP client integration with metadata support and add client filtering for tool execution

## 1.4.8

### Patch Changes

- ca1ef1d: added MCP ToolHandlerManager Component

## 1.4.7

### Patch Changes

- 608d096: moved @moc-global/loft-base-tsconfig to monorepo pnpm root devDependencies

## 1.4.6

### Patch Changes

- 4b059fd: migrated monorepo to PNPM, updated packages, upgraded LOFT Multi Part Content structure, updated MPC SDK and Structures, fixed types in LLM Strategies, added tool for sync versions across all packages, fixed a lot of monorepo problems, tests etc...
- 05efbbd: migrate from base-tsconfig to loft-base-tsconfig across all packages and include loft-base-tsconfig package to publish
- Updated dependencies [4b059fd]
- Updated dependencies [05efbbd]
  - @moc-global/loft-base-tsconfig@0.0.3

## 1.4.5

### Patch Changes

- 4b059fd: migrated monorepo to PNPM, updated packages, upgraded LOFT Multi Part Content structure, updated MPC SDK and Structures, fixed types in LLM Strategies, added tool for sync versions across all packages, fixed a lot of monorepo problems, tests etc...
- Updated dependencies [4b059fd]
  - @moc-global/base-tsconfig@0.0.2

## 1.4.4

### Patch Changes

- d02d0a5: Initial release
- Updated dependencies [d02d0a5]
  - @moc-global/loft-base-tsconfig@0.0.1
