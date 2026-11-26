# Common Gotchas — LOFT Framework

## Contents

- Setup
- Configuration
- Runtime
- Database
- MCP / Tools
- Testing
- Other

25 pitfalls, verified against the loft 3.0.0 source. Each gotcha includes symptom, root cause, and fix.

---

## Setup

### 1. Missing TypeScript Compiler Flags

**Symptom:** Inversify decorators in your own code (`@injectable()`, `@inject()` on classes you bind into the container) fail to compile, or their constructor dependencies do not resolve.
**Cause:** Inversify 6 uses legacy decorators, which need `experimentalDecorators: true`, and type-based constructor injection needs `emitDecoratorMetadata: true`. LOFT's prebuilt packages do not depend on your tsconfig, but every decorated class in your project does.
**Fix:** Add both flags to `compilerOptions`.

### 2. `reflect-metadata` Must Be First Import

**Symptom:** `Reflect.getMetadata is not a function` (or `Reflect.hasOwnMetadata is not a function`) at startup, or intermittent DI resolution failures.
**Cause:** `reflect-metadata` patches the global `Reflect` object. It is a peer dependency, so it may not be installed, and if any decorated class evaluates before the patch, its metadata is lost permanently.
**Fix:** Install `reflect-metadata` and make `import 'reflect-metadata'` the very first line of your entry point. Do not rely on transitive imports.

### 3. Peer Dependencies Must Match LOFT's Majors

**Symptom:** npm refuses to install (`ERESOLVE`), DI or type errors at runtime, or missing modules under Yarn.
**Cause:** inversify, reflect-metadata, zod, `@modelcontextprotocol/sdk`, `@moc-global/loft-definitions` and the provider SDK are peer dependencies. In loft 3.0.0 they must be inversify `^6.2.2` (not the latest major), zod `^4.6.6` (zod 3 is unsupported) and, for `@moc-global/loft-openai-strategy`, openai `^7.34.0` (openai 4 declares zod 3 as a peer). npm 7+ and pnpm install missing peers; Yarn does not. `langfuse` is an optional peer, needed only for `LangfuseTracer`.
**Fix:** Install the peers explicitly: `reflect-metadata inversify@^6 zod@^4.6.6 @modelcontextprotocol/sdk openai@^7`. Build any schema you pass to LOFT (e.g. `useLlmManifestSchema()`, a custom `generateRequestValidationSchema()`) with zod 4. Add `langfuse` if you use `LangfuseTracer`.

### 4. `registerLlmStrategy()` is Async

**Symptom:** First `generate()` fails with `An Llm Strategy with the name "X" does not exists.`
**Cause:** `registerLlmStrategy()` returns `Promise<void>`. It awaits manifest schema registration (which waits for the initial manifest load) and only then stores the strategy. Without `await`, `generate()` can run before the strategy exists. Registering an existing name again is skipped with a warning unless `forceOverwrite` is `true`.
**Fix:** `await loftConstructor.registerLlmStrategy(...)` before calling `getInstance()`. Concurrent registrations are serialised internally, so `Promise.all()` over distinct names is safe.

### 5. Streaming Is `generate({ onEvent })`, Not a Separate Constructor

**Symptom:** `StreamLoftConstructor` / `QueuedLoftConstructor` import fails; or `onEvent` receives no `text-delta` events and the whole reply arrives in `finish`.
**Cause:** Neither constructor exists. Streaming is `chat.generate({ onEvent })` (experimental); `LlmManager.generateStream()` is deprecated, and queued generation has no public API. When an AfterGenerate middleware that may change the reply is registered (or a strategy without `hasOutputMiddleware()`), the text policy defaults to `'after-middleware'` and text is held back until the end; LOFT logs a warning once naming the middleware.
**Fix:** Use `LoftConstructor` and `loft.chat.generate({ ..., onEvent })`. To stream text as it arrives, register non-modifying middleware with `{ transformsOutput: false }`, or set `textPolicy: 'all'` in `streamOptions` / `ChatConfig.streaming`.

### 6. Logger is a Global Singleton

**Symptom:** Log level changes unexpectedly across components.
**Cause:** `Logger` uses static fields. `LoftConstructor` calls `Logger.configure()` in its constructor, overwriting any previous configuration.
**Fix:** Pass desired log level to `LoftConstructor`. In tests, call `Logger.configure()` in `beforeEach`.

---

## Configuration

### 7. Manifest JSON Has Three-Level Nesting and Three Required Top-Level Keys

**Symptom:** `Manifest by name: X not found`, or `Error updating Manifest Cache` with a Zod error on load.
**Cause:** Structure is `llmManifests[manifestName][llmName]`, each entry with `systemMessage` and `modelPreset`. Developers often flatten one level. `llmManifests`, `prompts` and `aiTasks` are all required at the top level.
**Fix:** `{ "llmManifests": { "my-manifest": { "gpt-4o-mini": { "systemMessage": "...", "modelPreset": { ... } } } }, "prompts": {}, "aiTasks": {} }`.

### 8. LLM Name Must Match Across Three Places

**Symptom:** Strategy not found or manifest not found errors.
**Cause:** The string must be identical in: (1) `registerLlmStrategy(llmName, ...)`, (2) manifest JSON key, (3) `createSession({ currentLlmName })`.
**Fix:** Keep all three values the same string.

### 9. Manifest Keys Cannot Contain Quotes or Backslashes

**Symptom:** Zod validation error on manifest load.
**Cause:** Record keys are validated against `/^[^"'\\]*$/`.
**Fix:** Use only alphanumeric, hyphens, underscores, dots in manifest/LLM names.

### 10. Three Package Names Don't Match Directories

**Symptom:** `npm install` 404 or wrong package.
**Cause:** Directory names differ from npm names for 3 packages:
- `loft-manifest-s3-strategy/` → `@moc-global/loft-aws-s3-repository`
- `loft-manifest-gcp-storage-repository/` → `@moc-global/loft-gcp-storage-repository`
- `loft-azure-blob-repository/` → `@moc-global/loft-azure-blob-storage-repository`

**Fix:** Always use npm package names for installation.

---

## Runtime

### 11. Message `content` Is an Array of Parts, Not a String

**Symptom:** `GenerateError: Invalid direct messages` (Zod validation failure) or a type error.
**Cause:** `content` schema is `z.array(FullContentPartSchema)`. No plain string shorthand.
**Fix:** `content: [{ type: 'text', text: 'Hello' }]`

### 12. Every CreateMessage Needs Eight Fields in TypeScript

**Symptom:** TypeScript error `missing the following properties … ctx, llmIgnore` on `directMessages`, `augmentedContext` or `addMessages()`; or `Invalid direct messages` at runtime.
**Cause:** `Type.Entity.CreateMessage` is the Zod *output* type, so `sessionId` (a UUID), `role`, `author`, `llmName`, `manifestName`, `content`, `ctx` and `llmIgnore` are all required at compile time; only `id` is optional. The schema defaults (`content` `[]`, `ctx` `{}`, `llmIgnore` `false`) apply only when untyped data is parsed at runtime, where the first five are the hard requirement.
**Fix:** Pass all eight: `{ sessionId, role, author, llmName, manifestName, content: [{ type: 'text', text }], ctx: {}, llmIgnore: false }`.

### 13. Middleware Must Call `chain.next()` to Continue

**Symptom:** Only first middleware runs; downstream middlewares skipped.
**Cause:** `MiddlewareManager` checks `chain.nextCalled` after each middleware. If `false`, the loop breaks.
**Fix:** Call `chain.next()` (synchronous, returns `void`) in every middleware that should pass control forward. Omit `chain.next()` only to intentionally short-circuit.

### 14. Middleware Payloads Are Deep-Copied

**Symptom:** Mutations to payload don't persist to next middleware.
**Cause:** `MiddlewareManager` runs `fast-copy` on the returned payload after each step.
**Fix:** Return the modified payload explicitly. Treat it as a value, not a shared reference.

### 15. Duplicate Middleware Name Throws

**Symptom:** `A middleware with the name "X" already exists.` at startup.
**Cause:** `MiddlewareManager.use()` rejects duplicate names. No overwrite option.
**Fix:** Use unique names per stage. For tests, create fresh `ChatConstructor` instances.

### 16. AfterGenerate Middleware Receives `GenerateResultMessages`, Not the LLM Response

**Symptom:** Compile error on `payload.usage` or on middleware typed `StandardMiddleware<ContextInterface, Strategy.LLM.UnifiedLLMResponse>`.
**Cause:** `registerAfterGenerateMiddleware()` takes `StandardMiddleware<ContextInterface, Chat.GenerateResultMessages>`. The payload holds `llmResponse`, `directMessages`, `augmentedContext` and `save()`.
**Fix:** Type the middleware with `Chat.GenerateResultMessages` and read `payload.llmResponse.usage`, `payload.llmResponse.topChoice`, etc.

### 17. `generate()` Returns `ALREADY_GENERATED` With No Pending Messages

**Symptom:** `GenerateError` with status `ALREADY_GENERATED`.
**Cause:** No `directMessages`/`augmentedContext` provided, no Focus active, and last persisted message is not `user` role.
**Fix:** Either pass `directMessages` in `generate()`, or call `addMessages()` first with a user message.

---

## Database

### 18. PostgreSQL Needs `uuid-ossp` and Existing Schemas Before Migrations

**Symptom:** `function uuid_generate_v4() does not exist`, or `Schema "X" does not exist in the database. Create it first.`
**Cause:** Migration tables use `uuid_generate_v4()` as default PK value, and the migrator checks that the target schema exists instead of creating it.
**Fix:** Before running any LOFT migrations: `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";` and `CREATE SCHEMA IF NOT EXISTS loft_session;` / `CREATE SCHEMA IF NOT EXISTS loft_chat_history;`.

### 19. Two Separate Migration CLIs With Different Env Variables

**Symptom:** One migration succeeds, other fails.
**Cause:** `loft-session-pg-migrate` reads `DATABASE_SESSION_SCHEMA_NAME`, `loft-chat-history-pg-migrate` reads `DATABASE_CHAT_HISTORY_SCHEMA_NAME`. Both need `DATABASE_URL`. Without `--env`, the CLIs read `.env.loft-pg-migrations`.
**Fix:** Set all three env vars and run both CLIs (e.g. `npx loft-session-pg-migrate to-latest --env .env`). From code, use `runSessionPgMigrations` / `runChatHistoryPgMigrations` with `schemaName`.

### 20. Schema Name Must Match Runtime Config and Be Lower-Case

**Symptom:** Tables not found at runtime, or the migration rejects the schema name.
**Cause:** Migrations create tables in the schema from the env var / `schemaName`; runtime reads from the `{ schema }` param in the repository constructor. Schema names must match `/^[a-z_][a-z0-9_]{0,62}$/`.
**Fix:** Keep `DATABASE_SESSION_SCHEMA_NAME` and `new SessionRepositoryConstructor(dialect, { schema })` identical (likewise for chat history), using lower-case letters, digits and underscores.

---

## MCP / Tools

### 21. MCP Clients Must Be Registered Sequentially

**Symptom:** `useClient method is already running. Please use 'await' when calling useClient to ensure sequential execution.`
**Cause:** `MCPManager.useClient()` rejects a call while another registration is in progress.
**Fix:** `await chatConstructor.useMcpClient(...)` one at a time. Do not `Promise.all()`.

### 22. Default MCP Tool Call Loop Limit is 10

**Symptom:** LLM stops calling tools after 10 iterations with a system message about the limit.
**Cause:** `LlmManager.generate()` caps LLM calls per `generate()` at `chatConfig.mcp.maxCallsPerGenerate`, falling back to `LOFT_MCP_MAX_CALLS_PER_GENERATE`, then `10`.
**Fix:** Pass `{ mcp: { maxCallsPerGenerate: 50 } }` in `ChatConfig` for agentic use cases.

---

## Testing

### 23. Jest + Langfuse ESM Dynamic Import Error

**Symptom:** `A dynamic import callback was invoked without --experimental-vm-modules` when a `LangfuseTracer` is created.
**Cause:** The Langfuse SDK loads part of itself with `import()`. LOFT loads `langfuse` only when a `LangfuseTracer` is created.
**Fix:** Leave the tracer out in tests (LOFT then uses `NoOpTracerStrategy`), or mock `langfuse`, run Jest with `NODE_OPTIONS=--experimental-vm-modules`, or switch to Vitest.

---

## Other

### 24. Anthropic Strategy Doesn't Implement `generateResponseSchema()`

**Symptom:** `Error: Method generateResponseSchema() not implemented in Anthropic LLM Strategy.`
**Cause:** `AnthropicLoftStrategy` uses composition (not inheritance) and this method throws.
**Fix:** Do not call `generateResponseSchema()` on Anthropic strategy. Use AfterGenerate middleware for response validation.

### 25. Shutdown Rejects New Operations

**Symptom:** `ShutdownError` thrown after calling `shutdown()`; or the process keeps running after `loft.chat.shutdown()`.
**Cause:** After `shutdown()`, operations already in flight finish but new ones throw `ShutdownError`. Only `loft.shutdown()` also stops the LLM strategies' rate-limiter and queue timers and shuts the tracer down; `loftConstructor.gracefulShutdown()` is deprecated. Without `ChatConfig.shutdownTimeout`, `shutdown()` waits as long as requests run.
**Fix:** Stop accepting requests, then `await loft.shutdown()`. Set `shutdownTimeout` to bound the wait. Close your own DB pools and MCP clients afterwards.
