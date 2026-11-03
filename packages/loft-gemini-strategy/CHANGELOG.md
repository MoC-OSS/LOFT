# @moc-global/loft-gemini-strategy

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

## 1.2.0

### Minor Changes

- 9da30fb: Fixed: the generation settings of a manifest's model preset now reach Gemini. Before, the preset schema kept only the camelCase keys (`maxOutputTokens`, `topP`…) while the request read only the snake_case ones (`max_output_tokens`, `top_p`…), so only `temperature` was ever sent. Now the request config gets every preset key the strategy supports: `maxOutputTokens`, `temperature`, `topP`, `topK`, `stopSequences`, `candidateCount`, `presencePenalty`, `frequencyPenalty`, `responseLogprobs`, `logprobs`, `seed`, `safetySettings`, `toolConfig`, `thinkingConfig`, `responseMimeType` and `responseSchema`. `seed` and `thinkingConfig` (`thinkingBudget`, `includeThoughts`, `thinkingLevel`) are new preset keys. The preset schema also accepts `max_output_tokens`, `top_p`, `top_k`, `stop_sequences` and `candidate_count` as aliases; when a preset has both spellings, the camelCase key wins. A key the preset leaves out is not sent, and other keys are still ignored. Behaviour change: Gemini models now honour the output cap and sampling settings of their manifest entry, so replies from entries that set them may get shorter or different (a reply that hits the cap ends with `MAX_TOKENS`). Structured output works: `responseMimeType: "application/json"` with a `responseSchema` (Gemini's schema format) makes the model reply in JSON, and the reply streams. Behaviour change: `candidateCount` (or `candidate_count`) now reaches Gemini; before, it was dropped. A request with `candidateCount` above 1 is not streamed, because Vertex AI rejects it: its text reaches `onEvent` once the call returns.

  The request validation schema now declares every config key the strategy builds (the settings above and `tools`), so a request taken from the low-priority queue keeps its tools, tool config, safety settings, thinking config and response schema; before, they were dropped. Behaviour change: a declared key of the wrong type is now rejected, and any other key, such as the SDK's `httpOptions`, is dropped. Of `tools`, only the function declarations are kept: a tool that runs on Google's side, such as Google Search, URL context, code execution or retrieval, is dropped from a queued request.

  Fixed: a tool whose JSON Schema declares a list of types, such as `type: ["string", "null"]`, no longer fails the call with `type.toLowerCase is not a function`. The tool converter now turns a type list into its non-null type (or, for several, `anyOf` with one schema per type), with `nullable` when `null` is in the list. `anyOf` and `oneOf` become Gemini's `anyOf` (a `null` branch sets `nullable`, and a single other branch becomes the schema itself). The converter also keeps `nullable`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `pattern`, `format`, `default` and `title`, in nested items and properties too. Enum values are sent as strings, and a `null` enum value sets `nullable`. Other keywords are left out, as before.

  When Gemini gives a function call an id, the tool call now keeps it as its `callId` instead of a LOFT id, and the strategy sends it back on the function call and on the function response, so Gemini can match them. Behaviour change: such a `callId` no longer has the `<tool name>:::<random>` form; a call without an id still gets one. The tool call marks a Gemini id in its `_meta` (`geminiFunctionCallId`), so a LOFT id or another provider's id is never sent to Gemini. A function response is now named after the tool call it answers, so a history with another provider's call ids also names it right; a response whose call is not in the history is named after a LOFT `callId`, or `unknown` for any other id.

  API: `extractToolResultsFromContent` takes an optional second argument, the conversation's tool calls by `callId` (the new experimental `ToolCallsById` type), from which each function response gets its name and Gemini id. `GeminiRequest['config']` has the new optional settings. The exported `ModelPreset` type now has `responseSchema: unknown` instead of `any`, so code that reads its fields needs a cast.

- 9da30fb: `GeminiCallStrategy` streams inside `generate()` when LOFT passes an `onEvent` sink in the call options. The request is sent with `generateContentStream`, the first candidate's text reaches the sink as it arrives (its thought summaries as reasoning), and `generate()` resolves with the same `GenerateContentResponse` the request returns without streaming, so `formatToUnifiedLLMResponse`, `extractUsedTokens`, function calls and thought signatures work unchanged. Function-call arguments, thought signatures, code, inline data and the parts of other candidates are never sent to the sink; they only report activity. A finish on `SAFETY` and a blocked prompt are returned, not thrown. When a filter blocks the reply (`SAFETY`, `RECITATION`, `SPII` or `PROHIBITED_CONTENT`), the candidate has no content, as without streaming; the text already sent to the sink cannot be taken back, so the chat's `finish` event carries the empty text with `textReplaced`. An error in the middle of the stream rejects with the SDK's error. An abort of the call's signal rejects with an `AbortError`, as it does without streaming, even when the last chunk had already arrived. A stream that ends before every candidate finished, between events or inside one, without a blocked prompt, rejects with the SDK's `ApiError` with status 502 and the message "No HTTP error occurred: the stream ended before the model finished its reply" (the SDK's own error, if any, as its `cause`), so the call manager may retry it; once every candidate has finished, a stream cut short resolves with what arrived. An error object the SDK receives split across network reads also rejects with that 502, as the SDK does not recognise it, unless every candidate had already finished, when the reply stands. An empty text part without a thought signature is left out of the merged parts, unless the candidate has no other part. The provider logs a failed streamed call with the error's class, status, `type` and `code` only: the provider's own failure log never includes the error message. The call manager and the chat still log the error as before. Gemini sends the usage on many chunks as a running total, so each `usage` event replaces the one before. Without `onEvent` the request is sent as before (see the usage note below).

  `GeminiCallStrategy` takes an optional, experimental last constructor argument, `GeminiStrategyOptions`, with `streaming` (default `true`): `false` never streams, even when LOFT passes `onEvent`.

  The unified usage of a Gemini response now also carries `reasoningTokens` (the response's `thoughtsTokenCount`, when it has one) and `finishReason` (the first candidate's), for streamed and non-streamed calls alike.

  Deprecated, with nothing removed now: `GeminiCallStrategy.generateStream` and `extractContentFromChunk`, the `generateStream` method of `GeminiLoftStrategy` and `GeminiStream`. Use `chat.generate({ onEvent })` instead. They are removed in the next major release.

## 1.1.1

### Patch Changes

- aa4cfc4: Images in a message now reach Gemini. The request adapter sent text parts only and dropped images without a warning. A base64 image (or a base64 `data:` URL) now goes as `inlineData`, and an `https://` or `gs://` URL as `fileData`, which Gemini fetches. Other URLs are left out with a warning, as Gemini would reject every later request of the session. When the part has no MIME type, it comes from the data (PNG, JPEG, GIF, WebP, HEIC, AVIF, BMP) or the URL extension, and JPEG otherwise, with a warning.

## 1.1.0

### Minor Changes

- 4509845: Support `@google/genai` 2. The peer range is now `^1.30.0 || ^2.30.0`; the strategy needed no code changes.
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

- f5aa906: Keep Gemini 3 thought signatures, so tool calls work with Gemini 3.

  Gemini 3 models sign their thinking and reject a request whose earlier function calls come back without their signatures (400 "Function call is missing a thought_signature"). The strategy dropped the signatures, so every tool loop with a Gemini 3 model failed on its second request. It now keeps each signature in the `_meta` of the content part and sends it back. A turn whose function calls have no signature, such as one saved by an older LOFT version or made by another model of the session, is sent with Gemini's documented stand-in `skip_thought_signature_validator`. A `tool_call` content part takes an optional `_meta`, as the other content parts do; it stays outside `params`, which go to the MCP server. Thought summaries are no longer added to the answer text, in streaming too.

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

## 1.0.5

### Patch Changes

- 7db5371: Raise the minimum `@modelcontextprotocol/sdk` to `^1.26.0`, which fixes GHSA-345p-7cg4-v4c7: sharing an MCP server or transport instance could leak response data between clients. Loft itself uses the SDK client, so the fix matters if you share an `McpServer` or transport instance, for example through the `McpServer` and `InMemoryTransport` re-exports from `@moc-global/loft-definitions`. No API changes in Loft.
- Updated dependencies [151b683]
- Updated dependencies [7db5371]
  - @moc-global/loft-definitions@1.7.0

## 1.0.4

### Patch Changes

- c949af5: Simplify Logger API (remove DI injection, buffering), delete unused SMG code, fix MCP SDK vulnerability (upgrade to 1.25.0, pin Zod to 3.25.67)
- Updated dependencies [c949af5]
  - @moc-global/loft-definitions@1.6.3

## 1.0.3

### Patch Changes

- e2638a1: Fix Anthropic strategy to only include citations in ctx when defined
- Updated dependencies [e2638a1]
  - @moc-global/loft-definitions@1.6.2

## 1.0.2

### Patch Changes

- 812b01c: Added Jest ESM troubleshooting docs for Langfuse dynamic import error and made ctx field in Message schema default to {}.
- Updated dependencies [812b01c]
  - @moc-global/loft-definitions@1.6.1

## 1.0.1

### Patch Changes

- 26aff62: Add new Gemini strategy package with support for Vertex AI (GCP) and Google AI Studio authentication modes, including message adapters and MCP tool support
- Updated dependencies [b4b2015]
- Updated dependencies [5157af8]
- Updated dependencies [26aff62]
  - @moc-global/loft-definitions@1.6.0
