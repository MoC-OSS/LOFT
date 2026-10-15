# @moc-global/loft-agents

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
