# @moc-global/loft-agents

## 2.0.0

### Major Changes

- bc747ee: The `@moc-global/loft-definitions` peer dependency moves to its next major version, which needs zod 4 (`^4.6.6`) instead of zod 3. Upgrade `@moc-global/loft-definitions` and install zod 4 together with this release; this package's own API is unchanged.

### Patch Changes

- Updated dependencies [bc747ee]
  - @moc-global/loft@3.0.0
  - @moc-global/loft-definitions@2.0.0

## 1.1.0

### Minor Changes

- 19ede7d: `LoftAgentNode` stores its answer in the SharedContext.

  A node's answer reached only the next node, as its input. After a fan-out the next node got only the last branch's answer, and a team's parent got only the team's final answer, so coordinators and reviewers worked from partial results. Each `LoftAgentNode` now stores its answer under its name in the SharedContext, as the agents design describes: later nodes receive it with the shared context, and a team's parent receives its nodes' answers as `team:<team>:<node>`. Set `shareOutput: false` on a node to keep its answer out.

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

- Updated dependencies [19ede7d]
- Updated dependencies [19ede7d]
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
- Updated dependencies [19ede7d]
- Updated dependencies [19ede7d]
- Updated dependencies [19ede7d]
- Updated dependencies [19ede7d]
  - @moc-global/loft-definitions@1.8.0
  - @moc-global/loft@2.9.0

## 1.0.0

### Major Changes

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

- Updated dependencies [151b683]
- Updated dependencies [7db5371]
  - @moc-global/loft@2.8.0
  - @moc-global/loft-definitions@1.7.0
