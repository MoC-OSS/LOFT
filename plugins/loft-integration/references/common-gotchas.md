# Common Gotchas — LOFT Framework

## Contents

- Setup
- Configuration
- Runtime
- Database
- MCP / Tools
- Testing
- Other

Verified against source code. Each gotcha includes symptom, root cause, and fix.

---

## Setup

### 1. Missing TypeScript Compiler Flags

**Symptom:** `Reflect.getMetadata is not a function` at runtime.
**Cause:** Inversify requires `experimentalDecorators: true` AND `emitDecoratorMetadata: true` in tsconfig.json. Both must be present.
**Fix:** Add both flags to `compilerOptions`.

### 2. `reflect-metadata` Must Be First Import

**Symptom:** Intermittent DI resolution failures.
**Cause:** `reflect-metadata` patches the global `Reflect` object. If any decorated class evaluates before the patch, its metadata is lost permanently.
**Fix:** `import 'reflect-metadata'` must be the very first line of your entry point. Do not rely on transitive imports.

### 3. `registerLlmStrategy()` is Async

**Symptom:** First `generate()` fails with manifest validation error.
**Cause:** In loft 2.7.3, `registerLlmStrategy()` returns `Promise<void>`. It awaits manifest schema registration internally. Calling without `await` means `getInstance()` races against schema setup.
**Fix:** `await loftConstructor.registerLlmStrategy(...)` before calling `getInstance()`. Register strategies sequentially (concurrent registration throws).

### 4. `StreamLoftConstructor` / `QueuedLoftConstructor` Are Not Implemented

**Symptom:** Import fails or class is empty.
**Cause:** Both constructor files are entirely commented out in loft 2.7.3 source.
**Fix:** Use `LoftConstructor` with `BaseLoftChat`. For streaming, use `LlmManager.generateStream()` or strategy-level `generateStream()` directly.

### 5. Logger is a Global Singleton

**Symptom:** Log level changes unexpectedly across components.
**Cause:** `Logger` uses static fields. `LoftConstructor` calls `Logger.configure()` in its constructor, overwriting any previous configuration.
**Fix:** Pass desired log level to `LoftConstructor`. In tests, call `Logger.configure()` in `beforeEach`.

---

## Configuration

### 6. Manifest JSON Has Three-Level Nesting

**Symptom:** `Manifest by name: X not found`.
**Cause:** Structure is `llmManifests[manifestName][llmName]`. Developers often flatten one level.
**Fix:** Ensure the full nesting: `{ "llmManifests": { "my-manifest": { "gpt-4o-mini": { ... } } } }`.

### 7. LLM Name Must Match Across Three Places

**Symptom:** Strategy not found or manifest not found errors.
**Cause:** The string must be identical in: (1) `registerLlmStrategy(llmName, ...)`, (2) manifest JSON key, (3) `createSession({ currentLlmName })`.
**Fix:** Keep all three values the same string.

### 8. Manifest Keys Cannot Contain Quotes or Backslashes

**Symptom:** Zod validation error on manifest load.
**Cause:** Record keys are validated against `/^[^"'\\]*$/`.
**Fix:** Use only alphanumeric, hyphens, underscores, dots in manifest/LLM names.

### 9. Three Package Names Don't Match Directories

**Symptom:** `npm install` 404 or wrong package.
**Cause:** Directory names differ from npm names for 3 packages:
- `loft-manifest-s3-strategy/` → `@moc-global/loft-aws-s3-repository`
- `loft-manifest-gcp-storage-repository/` → `@moc-global/loft-gcp-storage-repository`
- `loft-azure-blob-repository/` → `@moc-global/loft-azure-blob-storage-repository`

**Fix:** Always use npm package names for installation.

---

## Runtime

### 10. Message `content` Is an Array of Parts, Not a String

**Symptom:** Type error or Zod validation failure.
**Cause:** `content` schema is `z.array(FullContentPartSchema)`. No plain string shorthand.
**Fix:** `content: [{ type: 'text', text: 'Hello' }]`

### 11. Six Fields Required on Every CreateMessage

**Symptom:** `Invalid direct messages` error.
**Cause:** Required fields: `sessionId`, `role`, `author`, `llmName`, `manifestName`, `content`.
**Fix:** Include all six. `ctx` (defaults `{}`) and `llmIgnore` (defaults `false`) are safe to omit.

### 12. Middleware Must Call `chain.next()` to Continue

**Symptom:** Only first middleware runs; downstream middlewares skipped.
**Cause:** `MiddlewareManager` checks `chain.nextCalled` after each middleware. If `false`, the loop breaks.
**Fix:** Call `await chain.next()` in every middleware that should pass control forward. Omit `chain.next()` only to intentionally short-circuit.

### 13. Middleware Payloads Are Deep-Copied

**Symptom:** Mutations to payload don't persist to next middleware.
**Cause:** `MiddlewareManager` runs `fast-copy` on the returned payload after each step.
**Fix:** Return the modified payload explicitly. Treat it as a value, not a shared reference.

### 14. Duplicate Middleware Name Throws

**Symptom:** `A middleware with the name "X" already exists.` at startup.
**Cause:** `MiddlewareManager.use()` rejects duplicate names. No overwrite option.
**Fix:** Use unique names per stage. For tests, create fresh `ChatConstructor` instances.

### 15. `generate()` Returns `ALREADY_GENERATED` With No Pending Messages

**Symptom:** `GenerateError` with status `ALREADY_GENERATED`.
**Cause:** No `directMessages`/`augmentedContext` provided and last persisted message is not `user` role.
**Fix:** Either pass `directMessages` in `generate()`, or call `addMessages()` first with a user message.

---

## Database

### 16. PostgreSQL Needs `uuid-ossp` Extension Before Migrations

**Symptom:** `function uuid_generate_v4() does not exist` during migration.
**Cause:** Migration tables use `uuid_generate_v4()` as default PK value.
**Fix:** `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";` before running any LOFT migrations.

### 17. Two Separate Migration CLIs With Different Env Variables

**Symptom:** One migration succeeds, other fails.
**Cause:** Session uses `DATABASE_SESSION_SCHEMA_NAME`, chat history uses `DATABASE_CHAT_HISTORY_SCHEMA_NAME`. Both need `DATABASE_URL`.
**Fix:** Set all three env vars. Run both CLIs.

### 18. Schema Name Must Match Runtime Config

**Symptom:** Tables not found at runtime.
**Cause:** Migration CLI creates tables in schema from env var. Runtime reads from `{ schema }` param in constructor.
**Fix:** Keep `DATABASE_SESSION_SCHEMA_NAME` and `SessionRepositoryConstructor({ schema })` identical.

---

## MCP / Tools

### 19. MCP Clients Must Be Registered Sequentially

**Symptom:** Only some MCP tools are available; tool-to-client mapping inconsistent.
**Cause:** `MCPManager.useClient()` has no mutex. Concurrent calls race on internal maps.
**Fix:** `await chatConstructor.useMcpClient(...)` one at a time. Do not `Promise.all()`.

### 20. Default MCP Tool Call Loop Limit is 10

**Symptom:** LLM stops calling tools after 10 iterations with a system message about the limit.
**Cause:** `LlmManager.generate()` caps at `chatConfig.mcp.maxCallsPerGenerate ?? 10`.
**Fix:** Pass `{ mcp: { maxCallsPerGenerate: 50 } }` in `ChatConfig` for agentic use cases.

---

## Testing

### 21. Jest + Langfuse ESM Dynamic Import Error

**Symptom:** `A dynamic import callback was invoked without --experimental-vm-modules`.
**Cause:** Langfuse CJS build uses `import()` internally. Jest's VM doesn't support this.
**Fix:** Either mock Langfuse in jest config, switch to Vitest, or run Jest with `--experimental-vm-modules`.

### 22. Zod Must Be Pinned to `3.25.67` With MCP

**Symptom:** `Type instantiation is excessively deep and possibly infinite.`
**Cause:** Zod 3.25.68+ triggers deep type inference with MCP SDK generics.
**Fix:** Pin `"zod": "3.25.67"` (no caret) in package.json.

---

## Other

### 23. Anthropic Strategy Doesn't Implement `generateResponseSchema()`

**Symptom:** `Error: Method generateResponseSchema() not implemented`.
**Cause:** `AnthropicLoftStrategy` uses composition (not inheritance) and this method was not implemented.
**Fix:** Do not call `generateResponseSchema()` on Anthropic strategy. Use AfterGenerate middleware for response validation.

### 24. Shutdown Blocks New Operations

**Symptom:** `ShutdownError` thrown after calling `shutdown()`.
**Cause:** `AbstractLoftChat.shutdown()` sets `isShuttingDown = true`. New operations check this flag and throw.
**Fix:** Stop sending requests before calling `shutdown()`. Await both `loft.shutdown()` and `loftConstructor.gracefulShutdown()`.
