# @moc-global/loft-openai-strategy

## 2.0.0

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

## 1.4.0

### Minor Changes

- 9da30fb: `OpenAiCallStrategy` and `AzureOpenAiCallStrategy` stream inside `generate()` when LOFT passes an `onEvent` sink in the call options. The request is sent with `stream: true`, the first choice's text and refusal reach the sink as they arrive, and `generate()` resolves with the same `ChatCompletion` the request returns without streaming, so `formatToUnifiedLLMResponse` and `extractUsedTokens` work unchanged. Tool-call arguments and the text of other choices are never sent to the sink; their chunks only report activity. A finish on the content filter is returned, not thrown, and an error in the middle of the stream rejects with the SDK's error. An abort of the call's signal rejects with the SDK's `APIUserAbortError`, as it does without streaming, even when the stream had already finished all choices. A stream that ends before every choice finished, between events or inside one, rejects with the SDK's retryable `APIConnectionError` (when it ends inside an event, with the SDK's parse error as its `cause`); once every choice has finished, a stream cut short in the `[DONE]` line or before the usage chunk resolves with what arrived; when the usage chunk was lost, token accounting falls back to 500 tokens. The provider logs a failed streamed call with the error's class, status, `type` and `code` only: the provider's own failure log never includes the error message. The call manager and the chat still log the error as before. Requests with a `json_schema` response format or a `strict` tool are not streamed, because the SDK can return a different result for them; they take the usual path, and LOFT sends the reply text once the call returns. Without `onEvent` nothing changes.

  Both call strategies take an optional, experimental last constructor argument, `OpenAiStrategyOptions`:

  - `streaming` (default `true`): `false` never streams, even when LOFT passes `onEvent`.
  - `streamUsage` (default `true`): asks the API to send the usage at the end of the stream (`stream_options.include_usage`). With `false` the usage of a streamed call is unknown, and token accounting falls back to 500 tokens, as it does today for a response without usage.
  - `clientOptions`: `{ timeout?, maxRetries? }`, passed to the `OpenAI` or `AzureOpenAI` client.

  `generateStream` and `extractContentFromChunk` of both call strategies, and the `generateStream` method of `OpenAiLoftStrategy` and `AzureOpenAiLoftStrategy` are deprecated, with nothing removed now. Use `chat.generate({ onEvent })` instead. They are removed in the next major release.

  The logprobs of a streamed call are added to one list per choice as they arrive, instead of copying the whole list for every chunk, so a long stream with `logprobs` takes linear time. The resulting `ChatCompletion` is unchanged.

### Patch Changes

- 9da30fb: Report reasoning tokens for OpenAI and Azure OpenAI reasoning models. The count is now read from `usage.completion_tokens_details.reasoning_tokens`, where the API puts it, so `reasoningTokens` in the unified usage is no longer always undefined.

## 1.3.0

### Minor Changes

- 4509845: Support `openai` 7. The peer range is now `^4.91.1 || ^7.34.0`; openai 4 still works, and openai 5 and 6 are left out because they are not tested.

  A response with a custom tool call, which newer openai versions can return, now fails with an error that names the type instead of a `TypeError`; LOFT declares only function tools. `generateStream()` of `OpenAiCallStrategy` and `AzureOpenAiCallStrategy` (experimental, not reachable through the public API) calls `chat.completions.create()` with `stream: true`, which both openai versions have, instead of `beta.chat.completions.stream()`.

- 19ede7d: Declare the libraries LOFT shares with your code as peer dependencies, and fill in the package metadata.

  - inversify, reflect-metadata, zod, the MCP SDK, `@moc-global/loft-definitions` (and `@moc-global/loft` for `loft-agents`) and the SDKs that appear in the public types (`openai`, `@anthropic-ai/sdk`, `@google/genai`, `@aws-sdk/client-sqs`) are peer dependencies instead of dependencies, so your project and LOFT use one copy of each. A custom constructor written against your own inversify now compiles. LOFT needs inversify 6 and zod 3. npm 7 or later and pnpm install missing peers on their own; with Yarn, add them to your dependencies.
  - `langfuse` is an optional peer dependency of `@moc-global/loft`, loaded only when a `LangfuseTracer` is created. If you use `LangfuseTracer`, install `langfuse` yourself; without it, the constructor throws an error that says so.
  - zod is no longer pinned to exactly 3.25.67; any zod 3 from 3.25.67 on works.
  - Every package declares the MIT license, a description, keywords, homepage, issue tracker and the `MoC-OSS/LOFT` repository with its directory.

### Patch Changes

- 19ede7d: Cancel timed-out agent calls and fix Focus completion.

  - Cancellation: `generate()` accepts an optional `signal` (AbortSignal). It is passed through the LLM manager and call manager to the Anthropic, OpenAI, Azure OpenAI and Gemini SDK calls, and the tool loop stops once the signal aborts. Aborted calls are not retried.
  - `loft-agents`: a node timeout now aborts the node's LLM call before any retry. `Agent.Node.run()` receives `options.signal`, `Orchestrator.run()` and `runFrom()` accept `{ signal }` to cancel a whole run, and retries stop once the run is cancelled.
  - `loft-agents`: `LoftAgentNode` takes a `focusName` option naming the registered Focus it collects. It no longer uses its node name as the Focus name; without `focusName` the session's Focus applies.
  - Focus: a completed Focus returns its values once in `focusStatus.filled` and then clears them from the focus state store, so it does not complete again with stale data.
  - Focus: completing a per-call Focus no longer deactivates a different session-level Focus.
  - Focus: collected values and shared context are written into prompts as escaped JSON in delimited blocks (`toPromptData`), with Focus string values capped at 500 characters, so user input cannot add prompt instructions.

- 19ede7d: Update dependencies to fix security advisories.

  - `@modelcontextprotocol/sdk`: `^1.26.0` -> `^1.31.0`
  - `axios`: `^1.13.5` -> `^1.20.0`
  - `fast-copy`: `^3.0.2` -> `^3.1.0`
  - `kysely`: `^0.27.3` -> `^0.28.17`
  - `@aws-sdk/client-s3` and `@aws-sdk/client-sqs`: -> `^3.1140.0` (pulls a patched `fast-xml-parser`)

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

## 1.2.13

### Patch Changes

- 7747867: Security fix for `AzureOpenAiCallStrategy`: when `endpoint` was not set, the client fell back to the placeholder `https://your-azure-openai-resource.com`. A third party owns that domain, so requests and their API key or Azure AD token could reach it. Without `endpoint`, the client now reads `AZURE_OPENAI_ENDPOINT` and throws if that is unset too. If you ran without `endpoint`, rotate your Azure OpenAI keys.

  Also fixes two ignored settings:
  - A configured `apiVersion` was replaced by a default.
  - A configured `deploymentName` was dropped, so requests went to the deployment named after the request's `model`. They now go to the configured deployment.

- 7db5371: Raise the minimum `@modelcontextprotocol/sdk` to `^1.26.0`, which fixes GHSA-345p-7cg4-v4c7: sharing an MCP server or transport instance could leak response data between clients. Loft itself uses the SDK client, so the fix matters if you share an `McpServer` or transport instance, for example through the `McpServer` and `InMemoryTransport` re-exports from `@moc-global/loft-definitions`. No API changes in Loft.
- Updated dependencies [151b683]
- Updated dependencies [7db5371]
  - @moc-global/loft-definitions@1.7.0

## 1.2.12

### Patch Changes

- c949af5: Simplify Logger API (remove DI injection, buffering), delete unused SMG code, fix MCP SDK vulnerability (upgrade to 1.25.0, pin Zod to 3.25.67)
- Updated dependencies [c949af5]
  - @moc-global/loft-definitions@1.6.3

## 1.2.11

### Patch Changes

- e2638a1: Fix Anthropic strategy to only include citations in ctx when defined
- Updated dependencies [e2638a1]
  - @moc-global/loft-definitions@1.6.2

## 1.2.10

### Patch Changes

- 812b01c: Added Jest ESM troubleshooting docs for Langfuse dynamic import error and made ctx field in Message schema default to {}.
- Updated dependencies [812b01c]
  - @moc-global/loft-definitions@1.6.1

## 1.2.9

### Patch Changes

- 5157af8: Add comprehensive Langfuse tracing, refactor ManifestManager to instance-based caching with recovery mechanisms (BREAKING: async LLM registration), fix parallel test execution with OS-based port allocation, remove Logger DI dependency.
- 26aff62: Add new Gemini strategy package with support for Vertex AI (GCP) and Google AI Studio authentication modes, including message adapters and MCP tool support
- Updated dependencies [b4b2015]
- Updated dependencies [5157af8]
- Updated dependencies [26aff62]
  - @moc-global/loft-definitions@1.6.0

## 1.2.8

### Patch Changes

- Updated dependencies [a06ad5a]
- Updated dependencies [9e62e13]
- Updated dependencies [19de13d]
- Updated dependencies [17ee776]
- Updated dependencies [7620009]
  - @moc-global/loft-definitions@1.5.0

## 1.2.7

### Patch Changes

- Updated dependencies [ca1ef1d]
  - @moc-global/loft-definitions@1.4.8

## 1.2.6

### Patch Changes

- 608d096: moved @moc-global/loft-base-tsconfig to monorepo pnpm root devDependencies
- Updated dependencies [608d096]
  - @moc-global/loft-definitions@1.4.7

## 1.2.5

### Patch Changes

- 4b059fd: migrated monorepo to PNPM, updated packages, upgraded LOFT Multi Part Content structure, updated MPC SDK and Structures, fixed types in LLM Strategies, added tool for sync versions across all packages, fixed a lot of monorepo problems, tests etc...
- 05efbbd: migrate from base-tsconfig to loft-base-tsconfig across all packages and include loft-base-tsconfig package to publish
- Updated dependencies [4b059fd]
- Updated dependencies [05efbbd]
  - @moc-global/loft-definitions@1.4.6

## 1.2.4

### Patch Changes

- 4b059fd: migrated monorepo to PNPM, updated packages, upgraded LOFT Multi Part Content structure, updated MPC SDK and Structures, fixed types in LLM Strategies, added tool for sync versions across all packages, fixed a lot of monorepo problems, tests etc...
- Updated dependencies [4b059fd]
  - @moc-global/loft-definitions@1.4.5

## 1.2.3

### Patch Changes

- d02d0a5: Initial release
- Updated dependencies [d02d0a5]
  - @moc-global/loft-definitions@1.4.4
