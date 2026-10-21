# @moc-global/loft-chat-history-pg-repository

## 2.0.0

### Major Changes

- 64a5326: Require Node.js 22.12 or later, for Kysely 0.29 and p-queue 10.

  The PostgreSQL repositories move from Kysely 0.28 to 0.29, and the call manager from p-queue 6 to 10. Both ship only ES modules, and the CommonJS build loads them with `require()`, which Node.js supports without a flag from 22.12. To upgrade, run Node.js 22.12 or later. The migrations, the migration CLIs and the database schema are unchanged. If you create the dialect with your own `kysely` package rather than the re-exported `SessionPostgresDialect` and `ChatHistoryPostgresDialect`, update it to 0.29 as well.

  `loft-llm-call-manager`: `GenerateCallManager.taskPQueue` is now typed as the new `TaskQueue` interface (`size`, `sizeBy()` and `add()`) instead of the p-queue class, because p-queue 10 publishes its types only through `exports`, which `moduleResolution: node` does not read. Code that calls other p-queue methods on `taskPQueue` needs a cast.

### Minor Changes

- 5e97c38: `ChatConfig.historyLimit` bounds how much history a request loads. A request then loads only that many of the latest messages of the session, still in chronological order, instead of the whole history; the default stays all of it. A limited history does not start with tool results whose tool call was cut off.

  - `Repository.ChatHistory.getMessages()` takes an optional `{ limit }`. The PostgreSQL repository reads only the latest messages; a custom repository that ignores it still works, as the chat history manager keeps the latest messages itself.
  - `getChatHistory()` still returns the whole history.
  - A `historyLimit` that is not an integer of 0 or more is rejected with a `TypeError`.
  - Without `historyLimit`, the chat history manager is called with the session id only, as before.

### Patch Changes

- 453ba5a: Rolling back migration `1.2.0` (`loft-chat-history-pg-migrate down`) works again. PostgreSQL rejected its `down` with "cannot use subquery in transform expression". `content` now gets the text of the first text part without JSON quotes, and a message without text (a tool call, an image) gets an empty string. Other parts are dropped, since the column holds text only.

## 1.4.0

### Minor Changes

- bf61e61: Return the keys inside message content, `ctx` and Focus values as they were saved.

  The repositories convert column names from snake_case to camelCase, and the conversion also reached the keys inside the jsonb columns. Saved data came back changed: tool call arguments such as `party_size` came back as `partySize`, `_meta` as `_Meta`, a session `ctx` key such as `user_id` as `userId`, and the keys of an object stored as a Focus field value were converted too, unlike in `InMemoryFocusStateStore`. Only column names are converted now. Code that reads such keys from saved messages or sessions in their camelCase form must use the names it saved.

- 19ede7d: Declare the libraries LOFT shares with your code as peer dependencies, and fill in the package metadata.

  - inversify, reflect-metadata, zod, the MCP SDK, `@moc-global/loft-definitions` (and `@moc-global/loft` for `loft-agents`) and the SDKs that appear in the public types (`openai`, `@anthropic-ai/sdk`, `@google/genai`, `@aws-sdk/client-sqs`) are peer dependencies instead of dependencies, so your project and LOFT use one copy of each. A custom constructor written against your own inversify now compiles. LOFT needs inversify 6 and zod 3. npm 7 or later and pnpm install missing peers on their own; with Yarn, add them to your dependencies.
  - `langfuse` is an optional peer dependency of `@moc-global/loft`, loaded only when a `LangfuseTracer` is created. If you use `LangfuseTracer`, install `langfuse` yourself; without it, the constructor throws an error that says so.
  - zod is no longer pinned to exactly 3.25.67; any zod 3 from 3.25.67 on works.
  - Every package declares the MIT license, a description, keywords, homepage, issue tracker and the `MoC-OSS/LOFT` repository with its directory.

### Patch Changes

- 19ede7d: Update dependencies to fix security advisories.

  - `@modelcontextprotocol/sdk`: `^1.26.0` -> `^1.31.0`
  - `axios`: `^1.13.5` -> `^1.20.0`
  - `fast-copy`: `^3.0.2` -> `^3.1.0`
  - `kysely`: `^0.27.3` -> `^0.28.17`
  - `@aws-sdk/client-s3` and `@aws-sdk/client-sqs`: -> `^3.1140.0` (pulls a patched `fast-xml-parser`)

- 19ede7d: Declare the supported Node.js versions: `engines.node` is `>=22`. CI tests Node 22, 24 and 26.
- 19ede7d: Stop shipping type declarations for the migration files and the migration CLI. Nothing in the public API refers to them, and they referred to an unpublished package. The migrations themselves still ship and run as before.
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

## 1.3.5

### Patch Changes

- Updated dependencies [151b683]
- Updated dependencies [7db5371]
  - @moc-global/loft-definitions@1.7.0

## 1.3.4

### Patch Changes

- c949af5: Simplify Logger API (remove DI injection, buffering), delete unused SMG code, fix MCP SDK vulnerability (upgrade to 1.25.0, pin Zod to 3.25.67)
- Updated dependencies [c949af5]
  - @moc-global/loft-definitions@1.6.3

## 1.3.3

### Patch Changes

- e2638a1: Fix Anthropic strategy to only include citations in ctx when defined
- Updated dependencies [e2638a1]
  - @moc-global/loft-definitions@1.6.2

## 1.3.2

### Patch Changes

- 812b01c: Added Jest ESM troubleshooting docs for Langfuse dynamic import error and made ctx field in Message schema default to {}.
- Updated dependencies [812b01c]
  - @moc-global/loft-definitions@1.6.1

## 1.3.1

### Patch Changes

- 1389d65: fix(migrations): build migrations as CJS-only to fix Kysely ERR_REQUIRE_ESM

## 1.3.0

### Minor Changes

- 5157af8: Add comprehensive Langfuse tracing, refactor ManifestManager to instance-based caching with recovery mechanisms (BREAKING: async LLM registration), fix parallel test execution with OS-based port allocation, remove Logger DI dependency.

### Patch Changes

- 26aff62: Add new Gemini strategy package with support for Vertex AI (GCP) and Google AI Studio authentication modes, including message adapters and MCP tool support
- bb3b08e: Fix migration path resolution and remove JSON import dependencies in database repository packages
- Updated dependencies [b4b2015]
- Updated dependencies [5157af8]
- Updated dependencies [26aff62]
  - @moc-global/loft-definitions@1.6.0

## 1.2.12

### Patch Changes

- Updated dependencies [a06ad5a]
- Updated dependencies [9e62e13]
- Updated dependencies [19de13d]
- Updated dependencies [17ee776]
- Updated dependencies [7620009]
  - @moc-global/loft-definitions@1.5.0

## 1.2.11

### Patch Changes

- Updated dependencies [ca1ef1d]
  - @moc-global/loft-definitions@1.4.8

## 1.2.10

### Patch Changes

- d65be1f: fixed order for getMessages() in PG Repository

## 1.2.9

### Patch Changes

- bbc892f: fixed publish errors

## 1.2.8

### Patch Changes

- dc8aabb: Replaced PGLite instead Postgresql + Docker for tests

## 1.2.7

### Patch Changes

- 608d096: moved @moc-global/loft-base-tsconfig to monorepo pnpm root devDependencies
- Updated dependencies [608d096]
  - @moc-global/loft-definitions@1.4.7

## 1.2.6

### Patch Changes

- 4b059fd: migrated monorepo to PNPM, updated packages, upgraded LOFT Multi Part Content structure, updated MPC SDK and Structures, fixed types in LLM Strategies, added tool for sync versions across all packages, fixed a lot of monorepo problems, tests etc...
- 05efbbd: migrate from base-tsconfig to loft-base-tsconfig across all packages and include loft-base-tsconfig package to publish
- Updated dependencies [4b059fd]
- Updated dependencies [05efbbd]
  - @moc-global/loft-definitions@1.4.6

## 1.2.5

### Patch Changes

- 4b059fd: migrated monorepo to PNPM, updated packages, upgraded LOFT Multi Part Content structure, updated MPC SDK and Structures, fixed types in LLM Strategies, added tool for sync versions across all packages, fixed a lot of monorepo problems, tests etc...
- Updated dependencies [4b059fd]
  - @moc-global/loft-definitions@1.4.5

## 1.2.4

### Patch Changes

- d02d0a5: Initial release
- Updated dependencies [d02d0a5]
  - @moc-global/loft-definitions@1.4.4
