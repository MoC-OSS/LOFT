# @moc-global/loft-session-pg-repository

## 1.2.5

### Patch Changes

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

- Updated dependencies [151b683]
- Updated dependencies [7db5371]
  - @moc-global/loft-definitions@1.7.0

## 1.2.4

### Patch Changes

- c949af5: Simplify Logger API (remove DI injection, buffering), delete unused SMG code, fix MCP SDK vulnerability (upgrade to 1.25.0, pin Zod to 3.25.67)
- Updated dependencies [c949af5]
  - @moc-global/loft-definitions@1.6.3

## 1.2.3

### Patch Changes

- e2638a1: Fix Anthropic strategy to only include citations in ctx when defined
- Updated dependencies [e2638a1]
  - @moc-global/loft-definitions@1.6.2

## 1.2.2

### Patch Changes

- 812b01c: Added Jest ESM troubleshooting docs for Langfuse dynamic import error and made ctx field in Message schema default to {}.
- Updated dependencies [812b01c]
  - @moc-global/loft-definitions@1.6.1

## 1.2.1

### Patch Changes

- 1389d65: fix(migrations): build migrations as CJS-only to fix Kysely ERR_REQUIRE_ESM

## 1.2.0

### Minor Changes

- 5157af8: Add comprehensive Langfuse tracing, refactor ManifestManager to instance-based caching with recovery mechanisms (BREAKING: async LLM registration), fix parallel test execution with OS-based port allocation, remove Logger DI dependency.

### Patch Changes

- 26aff62: Add new Gemini strategy package with support for Vertex AI (GCP) and Google AI Studio authentication modes, including message adapters and MCP tool support
- bb3b08e: Fix migration path resolution and remove JSON import dependencies in database repository packages
- Updated dependencies [b4b2015]
- Updated dependencies [5157af8]
- Updated dependencies [26aff62]
  - @moc-global/loft-definitions@1.6.0

## 1.1.11

### Patch Changes

- Updated dependencies [a06ad5a]
- Updated dependencies [9e62e13]
- Updated dependencies [19de13d]
- Updated dependencies [17ee776]
- Updated dependencies [7620009]
  - @moc-global/loft-definitions@1.5.0

## 1.1.10

### Patch Changes

- Updated dependencies [ca1ef1d]
  - @moc-global/loft-definitions@1.4.8

## 1.1.9

### Patch Changes

- bbc892f: fixed publish errors

## 1.1.8

### Patch Changes

- dc8aabb: Replaced PGLite instead Postgresql + Docker for tests

## 1.1.7

### Patch Changes

- 608d096: moved @moc-global/loft-base-tsconfig to monorepo pnpm root devDependencies
- Updated dependencies [608d096]
  - @moc-global/loft-definitions@1.4.7

## 1.1.6

### Patch Changes

- 4b059fd: migrated monorepo to PNPM, updated packages, upgraded LOFT Multi Part Content structure, updated MPC SDK and Structures, fixed types in LLM Strategies, added tool for sync versions across all packages, fixed a lot of monorepo problems, tests etc...
- 05efbbd: migrate from base-tsconfig to loft-base-tsconfig across all packages and include loft-base-tsconfig package to publish
- Updated dependencies [4b059fd]
- Updated dependencies [05efbbd]
  - @moc-global/loft-definitions@1.4.6

## 1.1.5

### Patch Changes

- 4b059fd: migrated monorepo to PNPM, updated packages, upgraded LOFT Multi Part Content structure, updated MPC SDK and Structures, fixed types in LLM Strategies, added tool for sync versions across all packages, fixed a lot of monorepo problems, tests etc...
- Updated dependencies [4b059fd]
  - @moc-global/loft-definitions@1.4.5

## 1.1.4

### Patch Changes

- d02d0a5: Initial release
- Updated dependencies [d02d0a5]
  - @moc-global/loft-definitions@1.4.4
