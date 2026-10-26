# @moc-global/loft-llm-call-manager

## 2.1.0

### Minor Changes

- 9da30fb: `GenerateCallManager` takes two optional config fields. `concurrency` (default 1) sets how many calls of the model run at the same time; a value that is not an integer of at least 1 throws a `RangeError`. `reserveTokens` (default true) is described below. `GenerateWithQueueManager` passes both through. `GenerateWithStreamManager` takes `concurrency` too, but not the reservation: with a concurrency above 1 its calls keep the old accounting, which checks the budget before the call and charges it after, so calls running at the same time can both pass the check.

  `LlmTokenRateLimiter` implements the rate limiter interface's new optional `acquire(tokens, signal?)`, which waits until the tokens and one request are available and takes both in one synchronous step, checking again after every wait; when `signal` aborts during a wait, it rejects at once and takes nothing. It fails with `LlmCallManagerLongAwaitError` once its waits add up to more than `maxAwaitSeconds`, and never refunds above `maxTokens`. A rate limiter without `acquire` is still used through `awaitBeforeCall`, `setUsedTokens` and `setUsedRequest`. A call that needs exactly the tokens left now passes without a wait. With `LlmTokenRateLimiter` (or any limiter that has `acquire`) and `reserveTokens` on, a call estimated above `maxTokens` waits only until the budget is full, then takes its whole estimate, which leaves the budget below zero; before, it waited for its whole shortfall and failed with `LlmCallManagerLongAwaitError` when that wait was longer than `maxAwaitSeconds`. With `reserveTokens: false`, or a limiter without `acquire`, the old behaviour stays.

  `makeGenerateRequest` takes an optional third argument, the reservation. `taskPQueueHandler` passes it, so a subclass that overrides `makeGenerateRequest` is still called. An override must pass the third argument on to `super`, or the manager must use `reserveTokens: false`; an override written for two arguments drops the reservation, so the base charges again on success and never refunds on failure.

  `GenerateCallManager`, and so `GenerateWithQueueManager` and `GenerateWithStreamManager`, now also retry provider errors of type `overloaded_error`, `api_error` or `server_error` that arrive without a status, through the shared retry policy.

  `TooManyHighPriorityTasksError` and `LlmCallManagerLongAwaitError` now set `name` to their class name as a string literal, which survives minification. A queued task that gives up reports that name.

  **Behaviour change:** tokens are now reserved before the call, so two calls running at the same time can no longer both pass the rate limiter on one budget. After a successful call the reservation is settled to the tokens the provider reports. A call that fails gives its tokens back but not its request, a call cancelled (aborted) after it took its reservation keeps both, and, with a rate limiter whose `acquire` watches the signal, such as `LlmTokenRateLimiter`, a call cancelled while it waits for the budget ends at once and takes nothing (the call manager passes the caller's signal to `acquire`). `reserveTokens: false` restores the previous accounting, which charged the tokens and the request only after a successful call.

  A reply whose used tokens cannot be read (the strategy's `extractUsedTokens` throws) now resolves: the failure is logged with the error's class, status and code, and the call keeps its reservation, or, with `reserveTokens: false`, charges only the request. Before, the call rejected after the provider had answered.

- 9da30fb: `GenerateCallManager` (and so `GenerateWithQueueManager`) supports streamed calls. When the call options carry an `onEvent` sink, every attempt first sends `{ type: 'request-start' }` to it, right before the provider call, and the provider gets a wrapped sink and a signal that combines the caller's signal with one of the attempt's own. These parts are experimental:

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

## 2.0.0

### Major Changes

- 64a5326: Require Node.js 22.12 or later, for Kysely 0.29 and p-queue 10.

  The PostgreSQL repositories move from Kysely 0.28 to 0.29, and the call manager from p-queue 6 to 10. Both ship only ES modules, and the CommonJS build loads them with `require()`, which Node.js supports without a flag from 22.12. To upgrade, run Node.js 22.12 or later. The migrations, the migration CLIs and the database schema are unchanged. If you create the dialect with your own `kysely` package rather than the re-exported `SessionPostgresDialect` and `ChatHistoryPostgresDialect`, update it to 0.29 as well.

  `loft-llm-call-manager`: `GenerateCallManager.taskPQueue` is now typed as the new `TaskQueue` interface (`size`, `sizeBy()` and `add()`) instead of the p-queue class, because p-queue 10 publishes its types only through `exports`, which `moduleResolution: node` does not read. Code that calls other p-queue methods on `taskPQueue` needs a cast.

### Minor Changes

- 5e97c38: `GenerateWithQueueManager` no longer requeues a task forever. A task that waits too long for the rate limiter goes back to the incoming queue with a `requeueAttempts` count, up to `maxRequeueAttempts` times (new config option, default 10). Then it goes, with its error, to an optional dead-letter queue (new sixth constructor argument), or to the outgoing queue as `{ sessionId, llmName, callContext, priority, error: { name, message } }`.

### Patch Changes

- 60f361d: A call aborted while it waits in the queue now leaves the queue at once: it rejects with the abort reason and no longer counts toward `highPriorityTasksLimit`. Before, it stayed queued until its turn came. A call aborted while it runs keeps its place until it ends, so calls still run one at a time.
- 5e97c38: The call managers retry only what can succeed on a new attempt, with backoff.

  - `GenerateCallManager` and `HttpCallManagerStrategy` retry 408, 429 and 5xx responses and network failures, and no longer retry a 400, 401 or 404, or any other error.
  - The wait doubles with each attempt, from `retryDelay`, between half and all of it at random (jitter), at most 60 s. A `Retry-After` (or `retry-after-ms`) header from the provider sets the wait instead.
  - `HttpCallManagerStrategy` waited nothing between attempts; it now takes an optional `retryDelay` (default 500 ms). `call()` and `streamCall()` throw the axios error itself for a response that is not retried (a 400, 401 or 404, say), instead of `Error("CallManager doesn't work")`; that error is still thrown, with the last error as its `cause`, when the retries run out.
  - `GenerateWithStreamManager` follows the same policy instead of retrying every error after a fixed delay.
  - The connection and timeout errors of the OpenAI and Anthropic SDKs are retried; they are recognised by their class, as their `name` is `Error`.
  - Aborting the call's `signal` ends the wait before a retry. An invalid `retryDelay` (NaN, say) counts as 0 instead of replacing the provider error.
  - `@moc-global/loft-definitions` exports the policy: `isRetryableError()`, `retryDelayMs()`, `retryAfterMs()`, `errorStatus()` and `waitForRetry()`.

## 1.1.0

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

### Patch Changes

- 19ede7d: Declare the supported Node.js versions: `engines.node` is `>=22`. CI tests Node 22, 24 and 26.
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

## 1.0.21

### Patch Changes

- Updated dependencies [151b683]
- Updated dependencies [7db5371]
  - @moc-global/loft-definitions@1.7.0

## 1.0.20

### Patch Changes

- c949af5: Simplify Logger API (remove DI injection, buffering), delete unused SMG code, fix MCP SDK vulnerability (upgrade to 1.25.0, pin Zod to 3.25.67)
- Updated dependencies [c949af5]
  - @moc-global/loft-definitions@1.6.3

## 1.0.19

### Patch Changes

- e2638a1: Fix Anthropic strategy to only include citations in ctx when defined
- Updated dependencies [e2638a1]
  - @moc-global/loft-definitions@1.6.2

## 1.0.18

### Patch Changes

- 812b01c: Added Jest ESM troubleshooting docs for Langfuse dynamic import error and made ctx field in Message schema default to {}.
- Updated dependencies [812b01c]
  - @moc-global/loft-definitions@1.6.1

## 1.0.17

### Patch Changes

- b4b2015: Refactor Logger to remove DI dependency, fix empty arrays in logs, and add LOFT branding with [LOFT] prefix in formatted output
- 5157af8: Add comprehensive Langfuse tracing, refactor ManifestManager to instance-based caching with recovery mechanisms (BREAKING: async LLM registration), fix parallel test execution with OS-based port allocation, remove Logger DI dependency.
- 26aff62: Add new Gemini strategy package with support for Vertex AI (GCP) and Google AI Studio authentication modes, including message adapters and MCP tool support
- Updated dependencies [b4b2015]
- Updated dependencies [5157af8]
- Updated dependencies [26aff62]
  - @moc-global/loft-definitions@1.6.0

## 1.0.16

### Patch Changes

- 2300e9f: improve error handling and retry logic
- Updated dependencies [a06ad5a]
- Updated dependencies [9e62e13]
- Updated dependencies [19de13d]
- Updated dependencies [17ee776]
- Updated dependencies [7620009]
  - @moc-global/loft-definitions@1.5.0

## 1.0.15

### Patch Changes

- Updated dependencies [ca1ef1d]
  - @moc-global/loft-definitions@1.4.8

## 1.0.14

### Patch Changes

- 75930b0: added Gracefully crop ChatHistory to maintain tool chain integrity

## 1.0.13

### Patch Changes

- 608d096: moved @moc-global/loft-base-tsconfig to monorepo pnpm root devDependencies
- Updated dependencies [608d096]
  - @moc-global/loft-definitions@1.4.7

## 1.0.12

### Patch Changes

- 4b059fd: migrated monorepo to PNPM, updated packages, upgraded LOFT Multi Part Content structure, updated MPC SDK and Structures, fixed types in LLM Strategies, added tool for sync versions across all packages, fixed a lot of monorepo problems, tests etc...
- 05efbbd: migrate from base-tsconfig to loft-base-tsconfig across all packages and include loft-base-tsconfig package to publish
- Updated dependencies [4b059fd]
- Updated dependencies [05efbbd]
  - @moc-global/loft-definitions@1.4.6

## 1.0.11

### Patch Changes

- 4b059fd: migrated monorepo to PNPM, updated packages, upgraded LOFT Multi Part Content structure, updated MPC SDK and Structures, fixed types in LLM Strategies, added tool for sync versions across all packages, fixed a lot of monorepo problems, tests etc...
- Updated dependencies [4b059fd]
  - @moc-global/loft-definitions@1.4.5

## 1.0.10

### Patch Changes

- d02d0a5: Initial release
- Updated dependencies [d02d0a5]
  - @moc-global/loft-definitions@1.4.4
