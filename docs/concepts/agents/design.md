# LOFT Agent Layer — Design Summary

Design document for the multi-agent orchestration layer on top of LOFT.

> **Status:** Phase 1 (Core), Phase 2 (Focus), Phase 3 (Team), and Phase 4 (Hardening) are implemented.

---

## Core Principle

**Existing LOFT instance = one agent.** The new layer orchestrates multiple LOFT instances without modifying LOFT internals. Zero breaking changes. Additive only.

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Orchestrator                                                │
│                                                              │
│  Chat History (one per user, persistent, visible to user)    │
│  SharedContext (per-run, ephemeral, invisible to user)       │
│  Focus State Store (per-session, persistent, invisible)      │
│                                                              │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐                │
│  │ Node A   │──→│ Node B   │──→│ Node C   │                │
│  │ LOFT inst│   │ LOFT inst│   │ LOFT inst│                │
│  │ Haiku    │   │ Sonnet   │   │ Opus     │                │
│  │ Router   │   │ Expert   │   │ Critic   │                │
│  └──────────┘   └──────────┘   └──────────┘                │
│       ↕               ↕              ↕                      │
│       └────── Transitions ───────────┘                      │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. New Concepts to Implement

### 2.1 Node — Universal Building Block

Everything is a Node: LLM agent, deterministic classifier, team of agents.

```typescript
interface Node {
  readonly name: string;
  readonly transitions: TransitionDef[];
  run(message: AgentMessage, sharedContext: SharedContextInterface, sessionId: string): Promise<NodeResult>;
}

interface NodeResult {
  output: AgentMessage;
  transition: Transition;
}
```

**Key implementation: LoftAgentNode** — wraps a LOFT instance as a Node:
- Constructor requires: `name`, `loft`, `llmName`, `manifestName`, `transitions`, optional `transitionResolver`
- Receives message + SharedContext + sessionId
- Injects SharedContext data into `augmentedContext`
- Calls `loft.chat.generate()` using the node's explicit `llmName`/`manifestName`
- Resolves transition from LLM response (tool call or deterministic)
- Returns NodeResult

**No separate "simple node" class.** Deterministic routing, API calls, or any non-LLM logic is implemented via `BeforeGenerateMiddleware` with `chain.preventGeneration()`. Every node is a LOFT instance — middleware decides whether the LLM is called or the response is computed locally.

### 2.2 Transitions — Routing Between Nodes

Each node declares available transitions statically (build-time):

```typescript
interface TransitionDef {
  name: string;          // e.g., "escalate", "approved", "billing"
  description: string;   // LLM-readable: "Use when user needs billing help"
  target: string | null; // target node name, null = terminal
}
```

Runtime transition types:

| Type | Behavior |
|------|----------|
| `TransitionSingle` | Route to exactly one target node (sequential) |
| `TransitionFanOut` | Route to multiple targets in parallel |
| `TransitionTerminal` | Execution complete, return final output |

### 2.3 SharedContext — Inter-Node Communication

Ephemeral key-value store, lives for one orchestrator run. Not persisted.

```typescript
class SharedContext {
  readonly sessionId: string;

  // Namespaced access (recommended for nodes)
  for(agentName: string): ScopedContext;

  // Direct access (for orchestrator-level logic)
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  keys(): string[];
  delete(key: string): boolean;
}

class ScopedContext {
  // Auto-prefixes: set('mood') → 'sentiment-agent.mood'
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
}
```

Properties:
- Concurrent-safe (for parallel FanOut execution)
- Namespaced to prevent collisions between agents
- Defensive copies on read (no leaked references)
- NOT for conversation history — only structured data

### 2.4 Focus — Goal-Oriented State Collection **[IMPLEMENTED]**

Enables structured data collection from users across multiple conversation turns.

```typescript
interface Focus {
  agentName: string;
  prompt: string;                    // Injected into agent system prompt
  fields: FocusField[];
  onComplete: FocusAction;
}

interface FocusField {
  key: string;
  type: FocusFieldType;              // Enum: STRING, NUMBER, BOOLEAN, ENUM, DATE
  values?: string[];                 // For ENUM type
  required: boolean;
  default?: unknown;                 // For optional fields
  description: string;               // LLM-readable
  validate?: (value: unknown) => boolean | string;  // Return string for custom error message
}

enum FocusFieldType { STRING = 'string', NUMBER = 'number', BOOLEAN = 'boolean', ENUM = 'enum', DATE = 'date' }
enum FocusActionType { TRANSITION = 'transition', TOOL = 'tool' }

interface FocusAction {
  type: FocusActionType;
  toolName?: string;                 // Call this tool when all required fields filled
  target?: string;                   // Transition to this node when complete
}
```

**Auto-generated tools per Focus** — injected as `AdditionalTool[]` (not MCP):

| Tool | Purpose |
|------|---------|
| `update_focus_{agentName}` | Validates + stores field values. Type coercion (string → number/boolean/date) + custom validation |
| `confirm_focus_{agentName}` | Shows summary of filled/missing fields. Reports ready status |
| `classify_focus_{agentName}` | Classifies user input: `on_focus` / `off_focus` / `unknown` |

**Focus State Store** — standalone persistence interface (not SessionRepository):

```typescript
interface FocusStateStore {
  get<T = unknown>(sessionId: string, agentName: string, fieldKey: string): Promise<T | undefined>;
  getAll(sessionId: string, agentName: string): Promise<Record<string, unknown>>;
  set<T = unknown>(sessionId: string, agentName: string, fieldKey: string, value: T): Promise<void>;
  delete(sessionId: string, agentName: string, fieldKey: string): Promise<void>;
  clear(sessionId: string, agentName: string): Promise<void>;
  clearAll(sessionId: string): Promise<void>;
}
```

**FocusStatus** — computed from stored values (not persisted directly):

```typescript
interface FocusStatus {
  filled: Record<string, unknown>;   // Collected values
  missing: string[];                  // Required fields still needed
  hasData: boolean;
  ready: boolean;                     // All required fields filled
}
```

**Two implementations:**
- `InMemoryFocusStateStore` — in `@moc-global/loft-agents` (for tests and simple use cases)
- `FocusStateStorePg` — in `@moc-global/loft-session-pg-repository` (PostgreSQL, `focus_state` table with migration 1.1.0)

**AdditionalTools** — per-call tool injection added to LOFT core:

```typescript
interface AdditionalTool {
  definition: { name: string; description: string; inputSchema: { ... } };
  handler: (args: Record<string, unknown>) => Promise<AdditionalToolResult>;
}
```

Additional tools are passed via `GenerateOptions.additionalTools`, merged with MCP tool definitions at the LLM layer. Tool calls are routed locally (handler function) instead of through MCPManager.

### 2.5 Orchestrator — Graph Execution Engine

```typescript
class OrchestratorBuilder {
  addNode(node: Node): this;
  setEntry(nodeName: string): this;
  build(): Orchestrator;             // Validates graph before returning
}

class Orchestrator {
  run(message: Message, sessionId: string): Promise<Message>;
}
```

**Execution loop:**

```
1. Receive user message
2. Write message to Chat History
3. Create SharedContext (ephemeral)
4. Load Focus states from Focus State Store (persistent)
5. Run entry node with message + SharedContext
6. Read NodeResult.transition:
   - TransitionSingle → run target node with output
   - TransitionFanOut → Promise.allSettled targets (SharedContext is concurrent-safe)
   - TransitionTerminal → return output to caller
7. Repeat from step 6 until terminal
```

**Build-time validation:**
- Entry node must exist
- All transition targets must reference existing nodes
- Focus nodes cannot be targets of FanOut (user can't answer two agents at once)
- No unreachable nodes (warning)

### 2.6 Team — Encapsulated Multi-Agent Unit **[IMPLEMENTED]**

A Team IS a Node. Contains its own Orchestrator + child Nodes internally.

```typescript
class TeamBuilder {
  constructor(name: string);
  systemPrompt(prompt: string): this;
  addNode(node: Node): this;
  setEntry(nodeName: string): this;
  setMaxDepth(n: number): this;
  addTransition(def: TransitionDef): this;
  build(): TeamNode;                 // Returns a Node
}
```

**TeamNode** — implements `Agent.Node`, wraps an internal `Orchestrator`:
- Constructor takes `name`, `orchestrator`, `transitions` (outgoing), optional `systemPrompt`
- `run()` creates fresh `SharedContext(sessionId)`, injects system prompt as `__team.systemPrompt` key, calls `orchestrator.run(message, sessionId, internalContext)`, resolves outgoing transition
- Outgoing transition resolution: 0 transitions = terminal, 1 transition = single (or terminal if target is null), 2+ transitions = throws `InvalidGraphError` (no resolver support yet)

**TeamBuilder** — fluent builder delegating to an internal `OrchestratorBuilder`:
- `addNode()`, `setEntry()`, `setMaxDepth()` delegate to internal `OrchestratorBuilder`
- `addTransition()` registers outgoing transitions for the team node in the parent graph
- `build()` calls `orchestratorBuilder.build()` to validate the internal graph, then wraps it in a `TeamNode`
- All `OrchestratorBuilder` validation rules apply to the internal graph

**Orchestrator.run() `externalContext` parameter** — optional third parameter allows TeamNode to inject its isolated SharedContext into the internal orchestrator (backward-compatible addition).

Properties:
- **Isolated SharedContext** — team creates new one; parent context not modified
- **Team system prompt** injected into internal SharedContext (not as a message)
- **Internal interactions invisible** to parent — team returns single NodeResult
- **Composable** — teams can contain teams (tested with double nesting)

---

## 3. Data Storage Model

```
┌──────────────────┬───────────────┬────────────────┬───────────────────┐
│                  │ Chat History  │ SharedContext   │ Focus State Store │
├──────────────────┼───────────────┼────────────────┼───────────────────┤
│ Contains         │ User <-> Bot  │ Node <-> Node  │ Structured form   │
│                  │ dialogue      │ data           │ fields            │
├──────────────────┼───────────────┼────────────────┼───────────────────┤
│ Lifetime         │ Entire session│ One run        │ Until Focus       │
│                  │               │                │ completes/clears  │
├──────────────────┼───────────────┼────────────────┼───────────────────┤
│ Who writes       │ Orchestrator  │ Any Node       │ Focus tools       │
│                  │ (final only)  │                │                   │
├──────────────────┼───────────────┼────────────────┼───────────────────┤
│ Who reads        │ All Nodes     │ All Nodes      │ Owning Node +     │
│                  │ (as context)  │ (current run)  │ Orchestrator      │
├──────────────────┼───────────────┼────────────────┼───────────────────┤
│ Visible to user  │ Yes           │ No             │ No                │
├──────────────────┼───────────────┼────────────────┼───────────────────┤
│ Persistent       │ Yes (DB)      │ No (memory)    │ Yes (DB/session)  │
├──────────────────┼───────────────┼────────────────┼───────────────────┤
│ Already in LOFT  │ Yes           │ No — new       │ No — new          │
└──────────────────┴───────────────┴────────────────┴───────────────────┘
```

**Key rule:** Only the Orchestrator writes the final response to Chat History. Intermediate node outputs stay in SharedContext.

---

## 4. Parallel vs Sequential Execution

Determined by Transition type returned by each node:

```
Sequential (TransitionSingle):
  Router → FAQ Agent → Critic → done

Parallel (TransitionFanOut):
               ┌→ Fact Check Agent  ─┐
  Generator ──→├→ Tone Check Agent  ─├→ Synthesis → done
               └→ Compliance Agent  ─┘

Mixed:
                                ┌→ Fact Check  ─┐
  User → Router → Expert Agent →│               ├→ Final → done
                                └→ Tone Check  ─┘
```

**Constraint:** Focus nodes only in sequential flows. Build-time validation enforces this.

---

## 5. Integration with Existing LOFT

Each agent = full LOFT instance. Nothing changes internally.

| Agent capability | How it works | Changes to LOFT |
|---|---|---|
| Own model | Separate `registerLlmStrategy()` per LOFT instance | None |
| Own prompt | Separate manifest with own systemMessage | None |
| Own middleware pipeline | Separate `ChatConstructor` with own middleware | None |
| Own tools (MCP) | Separate `MCPManager` per instance | None |
| Own modelPreset | In manifest: `{ modelPreset: { temperature: 0.1 } }` | None |
| Model switch at runtime | `temporaryLlmName` in GenerateOptions | None |

---

## 6. Package Structure

New package: `@moc-global/loft-agents`

```
packages/
  loft-agents/                       — @moc-global/loft-agents
    src/
      core/
        LoftAgentNode.ts             — LOFT wrapper implementing Agent.Node + NodeMetricsAware
        Orchestrator.ts              — Graph execution engine (policies, tracing, metrics, cycle detection)
        OrchestratorBuilder.ts       — Builder with graph validation + policy/observability config
        SharedContext.ts             — Ephemeral key-value store + ScopedContext
      errors/
        AgentError.ts                — Base error class
        FanOutPartialError.ts        — Carries fulfilled + rejected results
        InvalidGraphError.ts
        MaxDepthExceededError.ts
        NoEntryNodeError.ts
        NodeNotFoundError.ts
        NodeRetryExhaustedError.ts   — Retry exhaustion (Phase 4)
        NodeTimeoutError.ts          — Timeout exceeded (Phase 4)
        index.ts                     — Barrel export
      focus/
        InMemoryFocusStateStore.ts   — In-memory implementation of FocusStateStore
        FocusStatusComputer.ts       — Computes FocusStatus from stored values
        FocusPromptGenerator.ts      — Generates system prompt fragment for Focus
        FocusToolGenerator.ts        — Generates AdditionalTool[] from Focus definition
        FocusTypeCoercion.ts         — Type coercion and validation (string → number/boolean/date/enum)
        UpdateFocusTool.ts           — Validates + stores field values
        ConfirmFocusTool.ts          — Returns status summary (filled/missing/ready)
        ClassifyFocusTool.ts         — Classifies user input relevance
        index.ts                     — Barrel export
      policies/                      — (Phase 4)
        RetryPolicy.ts               — withRetry() wrapper with exponential backoff
        TimeoutPolicy.ts             — withTimeout() wrapper using Promise.race
        index.ts                     — Barrel export
      observability/                 — (Phase 4)
        TracingIntegration.ts        — Span helpers for orchestrator, node, FanOut, retry events
        Metrics.ts                   — MetricsCollector class
        index.ts                     — Barrel export
      team/
        TeamNode.ts                  — Node implementation with internal orchestrator
        TeamBuilder.ts               — Fluent builder delegating to OrchestratorBuilder
        index.ts                     — Barrel export
      index.ts                       — Public API exports

  loft-definitions/
    src/shared/components/
      Agent.ts                       — All agent interfaces, enums, types (incl. policies, metrics, ErrorStrategy)
```

Dependencies: `@moc-global/loft`, `@moc-global/loft-definitions`

---

## 7. Implementation Phases

Each phase is a self-contained unit of work, designed to be proposed and implemented independently.

---

### Phase 1 — Core: Node + Transitions + SharedContext + Orchestrator [COMPLETE]

**Depends on:** nothing (greenfield package)

**Goal:** Wire multiple LOFT instances into sequential and parallel chains with inter-node data passing.

**Scope — what to build:**

1. **Package scaffolding** — `packages/loft-agents/`, tsup config, dual ESM/CJS output, package.json with `@moc-global/loft-agents` name. Follow existing packages (e.g. `loft-base-package`) as template for config.

2. **Types** — `Message` (role, content, data map for node-to-node structured data), `TransitionDef` (name, description, target), `Transition` (discriminated union: `TransitionSingle` | `TransitionFanOut` | `TransitionTerminal`), `NodeResult` (output Message + Transition).

3. **Node interface** — `name: string`, `run(message, sharedContext): Promise<NodeResult>`, `transitions: TransitionDef[]`.

4. **LoftAgentNode** — implementation of Node that wraps a `LOFT` instance. `run()` calls `loft.chat.generate()`, passing incoming message as `directMessages` and SharedContext data as `augmentedContext`. Resolves which transition to take from LLM response (via tool call or pattern matching on response content). Constructor takes: `name`, `loft` (LOFT instance), `llmName`, `manifestName`, `transitions` (TransitionDef[]), optional `transitionResolver: Agent.TransitionResolver` (custom function to determine transition from GenerateResult).

5. **SharedContext** — in-memory key-value store. `sessionId: string`, `get<T>(key)`, `set<T>(key, value)`, `keys()`, `delete(key)`, `for(agentName): ScopedContext`. ScopedContext auto-prefixes keys with agent name. Concurrent-safe for FanOut (reads/writes protected). Defensive copies on `get()` via `structuredClone`.

6. **Orchestrator** — `run(message, sessionId): Promise<AgentMessage>`. Implements the execution loop: create SharedContext → run entry node → resolve transition → run next node(s) → repeat until TransitionTerminal. For FanOut: `Promise.allSettled` on target nodes; throws `FanOutPartialError` (carries fulfilled + rejected) if any fail. Max depth counter (default 10, configurable) — throws `MaxDepthExceededError` if exceeded.

7. **OrchestratorBuilder** — `addNode(node)`, `setEntry(nodeName)`, `setMaxDepth(n)`, `build(): Orchestrator`. Build-time validation: entry node exists, all transition targets reference existing nodes, no duplicate node names. Warnings for unreachable nodes.

8. **Error types** — `AgentError` (base), `NodeNotFoundError`, `NoEntryNodeError`, `InvalidGraphError`, `MaxDepthExceededError`, `FanOutPartialError` (carries `fulfilled: NodeResult[]` and `rejected: FanOutRejection[]`). Each in its own file with barrel `index.ts`.

9. **Unit tests** — sequential chain (A → B → C → terminal), parallel FanOut (A → [B, C] → D → terminal), SharedContext isolation (namespaced writes don't collide), max depth exceeded, build-time validation errors, LoftAgentNode with mocked LOFT instance.

**Acceptance criteria:**
- `pnpm install` and `turbo build --filter=@moc-global/loft-agents` succeed
- Sequential orchestration: 3 nodes pass data through SharedContext to produce final output
- Parallel orchestration: FanOut to 2+ nodes, results available to next node via SharedContext
- Builder rejects invalid graphs at build time
- Max depth 10 stops infinite loops
- All tests pass

**Out of scope:** Focus, Team, Chat History writes (orchestrator returns Message, caller decides what to do with it), retry/timeout policies.

**Key files to create:**
```
packages/loft-agents/
  package.json
  tsconfig.json
  tsconfig.declarations.json
  tsup.config.ts
  vitest.config.ts
  src/
    index.ts                         — public API exports
    types/
      Message.ts
      Transition.ts                  — TransitionDef + runtime Transition union
      NodeResult.ts
    core/
      Node.ts                        — interface
      LoftAgentNode.ts               — LOFT wrapper implementation
      SharedContext.ts               — includes ScopedContext
      Orchestrator.ts                — execution engine
      OrchestratorBuilder.ts         — builder + validation
    errors/
      index.ts                       — all error classes
    __tests__/
      unit/
        SharedContext.test.ts
        OrchestratorBuilder.test.ts
        Orchestrator.test.ts
        LoftAgentNode.test.ts
```

**Existing LOFT code to reference:**
- `packages/loft/src/LOFT.ts` — LOFT class that LoftAgentNode wraps
- `packages/loft/src/workflows/chat/BaseLoftChat.ts` — `generate()` method signature and GenerateOptions/GenerateResult types
- `packages/loft-definitions/src/shared/components/chat/Chat.ts` — ChatInterface types
- `packages/loft-base-package/` — template for package scaffolding
- `packages/loft-base-tsconfig/` — shared tsconfig to extend

---

### Phase 2 — Focus: Structured State Collection [COMPLETE]

**Depends on:** Phase 1 (Node, SharedContext, LoftAgentNode, Orchestrator)

**Goal:** Agents can collect structured, validated data from users across multiple conversation turns, persisted between runs via FocusStateStore.

**What was built:**

1. **Focus definition** — types with enums (`FocusFieldType`, `FocusActionType`, `FocusClassification`) in `loft-definitions/Agent.ts`. `FocusField` includes `validate?` returning `boolean | string` for custom error messages.

2. **FocusStateStore** — standalone persistence interface (not SessionRepository extension). Generic `get<T>`/`set<T>`, batch `getAll()`, `delete`, `clear`, `clearAll`. Two implementations: `InMemoryFocusStateStore` (loft-agents) and `FocusStateStorePg` (loft-session-pg-repository with migration 1.1.0).

3. **FocusStatus** — computed by `computeFocusStatus(focus, storedValues)`, not persisted. Reports `filled`, `missing`, `hasData`, `ready`.

4. **FocusTools** — three auto-generated tools per Focus, injected as `AdditionalTool[]` (per-call tool injection, not MCP):
   - `UpdateFocusTool` — type coercion (LLM sends strings → coerce to number/boolean/date/enum) + custom validation + store
   - `ConfirmFocusTool` — status summary (filled/missing/ready)
   - `ClassifyFocusTool` — classifies user input as `on_focus` / `off_focus` / `unknown`

5. **AdditionalTools in LOFT core** — `Chat.AdditionalTool` type, `GenerateOptions.additionalTools`, LlmManager merges definitions with MCP tools, routes tool calls to local handlers.

6. **LoftAgentNode Focus integration** — constructor validates focus/focusStateStore pairing, `run()` injects Focus prompt + tools, post-generate checks `FocusStatus.ready` and overrides transition via `onComplete`.

7. **Build-time validation** — `OrchestratorBuilder.validateFanOutFocusTargets()` rejects FanOut transitions targeting `FocusAware` nodes.

8. **Unit tests** — 93 tests across 9 test files (FocusStatusComputer, FocusTypeCoercion, FocusTools, FocusPromptGenerator, InMemoryFocusStateStore, FocusStateStorePg, LoftAgentNode Focus integration, OrchestratorBuilder FanOut validation).

**Key files created/modified:**
```
packages/loft-agents/src/focus/
  InMemoryFocusStateStore.ts         — In-memory FocusStateStore
  FocusStatusComputer.ts             — computeFocusStatus()
  FocusPromptGenerator.ts            — generateFocusPrompt()
  FocusToolGenerator.ts              — generateFocusTools()
  FocusTypeCoercion.ts               — coerceValue() + validateField()
  UpdateFocusTool.ts                 — handleUpdateFocus()
  ConfirmFocusTool.ts                — handleConfirmFocus()
  ClassifyFocusTool.ts               — handleClassifyFocus()
  index.ts

packages/loft-definitions/src/shared/components/
  Agent.ts                           — Focus types, enums, FocusStateStore interface
  Chat.ts                            — AdditionalTool, AdditionalToolResult types

packages/loft/src/managers/LlmManager.ts          — AdditionalTool routing
packages/loft/src/workflows/chat/BaseLoftChat.ts   — additionalTools passthrough
packages/loft-session-pg-repository/
  src/repository/FocusStateStorePg.ts              — PostgreSQL implementation
  src/migrations/1.1.0.ts                          — focus_state table
```

---

### Phase 3 — Team: Encapsulated Multi-Agent Unit [COMPLETE]

**Depends on:** Phase 1 (Node, Orchestrator, SharedContext)

**Goal:** A group of agents packaged as a single Node with isolated internal state. Composable and reusable.

**What was built:**

1. **TeamNode** — implements `Agent.Node`. Contains `name`, optional `systemPrompt`, internal `Orchestrator`, outgoing `transitions`. `run()` creates fresh `SharedContext(sessionId)`, injects team system prompt into internal context, calls `orchestrator.run(message, sessionId, internalContext)`, resolves outgoing transition deterministically.

2. **TeamBuilder** — fluent builder: `constructor(name)`, `.systemPrompt()`, `.addNode()`, `.setEntry()`, `.setMaxDepth()`, `.addTransition()`, `.build(): TeamNode`. Delegates to internal `OrchestratorBuilder` for graph validation.

3. **Context isolation** — parent SharedContext is NOT passed to team. Team creates its own `SharedContext`. Parent context unchanged after team execution. Verified with nested team tests (double context isolation).

4. **Orchestrator `externalContext`** — backward-compatible optional parameter `Orchestrator.run(message, sessionId, externalContext?)` allows TeamNode to inject its isolated context.

5. **Shared test helpers** — `__tests__/helpers.ts` with `nodeResult`, `single`, `fanOut`, `terminal`, `stubNode`, `staticNode`, `msg` used by Orchestrator, TeamNode, and TeamBuilder tests.

6. **Unit tests** — 15 tests across 2 files:
   - `TeamNode.test.ts` (9): sequential flow, parent context unmodified, internal isolation, system prompt injection, no system prompt, TransitionSingle, TransitionTerminal, multiple transitions error, error propagation
   - `TeamBuilder.test.ts` (6): valid build, missing entry, invalid targets, duplicate names, zero outgoing terminal, nested team with double context isolation

**Key files created:**
```
packages/loft-agents/src/
  team/
    TeamNode.ts                      — Node implementation with internal orchestrator
    TeamBuilder.ts                   — Fluent builder delegating to OrchestratorBuilder
    index.ts                         — Barrel export
  __tests__/
    helpers.ts                       — Shared test helpers
    unit/
      TeamNode.test.ts
      TeamBuilder.test.ts
```

**Key files modified:**
```
packages/loft-agents/src/
  core/Orchestrator.ts               — Added optional externalContext parameter
  index.ts                           — Added TeamNode, TeamBuilder exports
```

---

### Phase 4 — Production Hardening [COMPLETE]

**Depends on:** Phase 1, Phase 2, Phase 3

**Goal:** Make the agent layer production-ready with reliability, observability, and safety mechanisms.

**What was built:**

1. **Retry policies** — `withRetry(fn, policy, nodeName, onRetry?)` wrapper with exponential backoff. Returns `RetryResult<T>` containing `{ result, retryCount }`. Configurable per-node via `OrchestratorBuilder.addNode(node, { retry: { maxRetries, delayMs, backoffMultiplier?, retryOn? } })`. Throws `NodeRetryExhaustedError` after all retries exhausted.

2. **Timeout per node** — `withTimeout(fn, policy, nodeName)` wrapper using `Promise.race` against `setTimeout`. Timer cleaned up on success/error. Throws `NodeTimeoutError`. Does NOT cancel underlying LLM call (no AbortController in LOFT).

3. **Policy composition** — Orchestrator wraps `node.run()`: timeout applies per attempt (inner), retry wraps timeout (outer). Policies configured per-node via `OrchestratorBuilder`:
   ```typescript
   builder.addNode(node, {
     retry: { maxRetries: 3, delayMs: 1000, backoffMultiplier: 2 },
     timeout: { timeoutMs: 30000 }
   });
   ```

4. **Error handling strategy** — `ErrorStrategy` enum (`FAIL_FAST`, `CONTINUE`) in `loft-definitions/Agent.ts`. Fail-fast (default): any node error stops orchestration. Continue: for FanOut, collect partial results and continue to convergence node. Rejected branch info stored in SharedContext under `Agent.FANOUT_REJECTED_KEY`. Sequential errors always propagate regardless of strategy.

5. **Tracing integration** — optional `Strategy.Tracer.Tracer` passed via `OrchestratorBuilder.setTracer()`. Creates orchestrator span (wraps entire `run()`), node spans (children, per `node.run()`), FanOut spans (wraps parallel execution). Retry attempts logged as events within node spans via `onRetry` callback. Zero overhead when tracer not configured.

6. **Metrics collection** — callback-based via `OrchestratorBuilder.setMetricsCallback()`. `MetricsCollector` tracks per-node timing, retry count, transition path, and token usage. Uses `nodeIndexes` Map for O(1) lookup by name. `NodeMetricsAware` duck-typed interface (`getLastMetrics()`) allows nodes to expose token usage — `LoftAgentNode` implements it, capturing usage from `GenerateResult`.

7. **Cycle detection** — optional, advisory-only (warning, not error). Tracks node-name sequence during a run, checks for repeating patterns up to `MAX_CYCLE_PATTERN_LENGTH = 10`. Configurable via `OrchestratorBuilder.setCycleDetection(true)`.

8. **New error types** — `NodeTimeoutError` (nodeName, timeoutMs) and `NodeRetryExhaustedError` (nodeName, maxRetries, lastError), both extending `AgentError`.

9. **All policies are optional** — zero-config works exactly as before. Node interface unchanged; policies are orchestration-level configuration.

**Unit tests** — 147 tests across 17 test files, including:
- `RetryPolicy.test.ts` (6): retries, maxRetries, backoff, retryOn filter, NodeRetryExhaustedError
- `TimeoutPolicy.test.ts` (4): resolve before timeout, NodeTimeoutError, timer cleanup
- `ErrorStrategy.test.ts` (5): fail-fast default, continue partial, rejected in SharedContext, all-fail throws, sequential propagation
- `TracingIntegration.test.ts` (5): orchestrator span, nested node spans, FanOut span, error span, no-tracer no-op
- `Metrics.test.ts` (6): callback on success/error, node duration, transition path, no-callback no-op, NodeMetricsAware
- `CycleDetection.test.ts` (4): pattern detection, no false positives, disabled no-op, advisory-only
- `Orchestrator.test.ts` (5 policy tests): retry, retry exhausted, timeout, composition, no-policy unchanged

**Key files created:**
```
packages/loft-agents/src/
  policies/
    RetryPolicy.ts                   — withRetry() wrapper, RetryResult<T> type
    TimeoutPolicy.ts                 — withTimeout() wrapper
    index.ts                         — Barrel export
  observability/
    TracingIntegration.ts            — createOrchestratorSpan, createNodeSpan, createFanOutSpan, logRetryEvent
    Metrics.ts                       — MetricsCollector class
    index.ts                         — Barrel export
  errors/
    NodeTimeoutError.ts              — extends AgentError
    NodeRetryExhaustedError.ts       — extends AgentError
```

**Key files modified:**
```
packages/loft-agents/src/
  core/Orchestrator.ts               — Policy wrapping, tracing spans, metrics collection, cycle detection
  core/OrchestratorBuilder.ts        — setErrorStrategy(), setTracer(), setMetricsCallback(), setCycleDetection(), addNode() with policy
  core/LoftAgentNode.ts              — Captures token usage, implements NodeMetricsAware
  errors/index.ts                    — New error exports
  index.ts                           — New public API exports

packages/loft-definitions/src/shared/components/
  Agent.ts                           — ErrorStrategy enum, OrchestratorOptions, RetryPolicy, TimeoutPolicy,
                                       NodePolicy, NodeUsageMetrics, NodeMetrics, OrchestratorMetrics,
                                       NodeMetricsAware, FANOUT_REJECTED_KEY constant
```

---

## 8. Business Use Cases (Target)

| Use Case | Pattern | Agents |
|---|---|---|
| Customer support | Sentiment + Tiered | Router, Sentiment, FAQ (Haiku), Expert (Sonnet), Escalation |
| Insurance intake | Focus + Sequential | Router, Intake with Focus, Validator, Quote Calculator |
| Content moderation | Parallel critics | Generator, Fact-Check, Tone-Check, Compliance → Synthesis |
| Financial advisory | Multi-persona | Optimist, Risk Analyst, Moderator → Balanced recommendation |
| Document processing | Pipeline | OCR/Extraction, Validation, Processing, Notification |
| Tiered knowledge | Escalation chain | FAQ (Haiku+RAG), Deep Expert (Sonnet), Human Handoff |

---

## 9. Competitive Advantages over Alternatives

| vs | LOFT Agents advantage |
|---|---|
| Agno | Model switching at runtime works (via LOFT DI + temporaryLlmName) |
| LangGraph | TypeScript-native, not Python. Full middleware pipeline per agent |
| CrewAI | Each agent has real middleware, tools, manifest — not just role/goal strings |
| AutoGen | Not conversation-based coordination — structured SharedContext + typed Focus |
| Swarm | Focus for structured collection, Team encapsulation, parallel execution |

Key differentiator: **each agent is a production-grade LOFT instance** with full middleware, tools, streaming, manifests — not a thin wrapper around an LLM call.

---

## 10. Decisions Made

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | Session strategy | **One shared session** per orchestrator | All agents see the same Chat History. Simpler, less storage, full context available to every node. |
| 2 | Focus State Store | **Standalone FocusStateStore interface** | Separate from SessionRepository. Dedicated `focus_state` table in PG. Simpler interface, no coupling to session internals. |
| 3 | Package name | **`@moc-global/loft-agents`** | Agents are the core concept. |
| 4 | Non-LLM nodes | **No separate class. All nodes are LOFT instances.** | Deterministic logic via `BeforeGenerateMiddleware` + `preventGeneration()`. One abstraction for everything. |
| 5 | Max iterations | **Configurable, default 10** | Prevents infinite loops. Sufficient for most business flows. |
| 6 | Streaming | **Out of scope** | Not a priority. Can be added later as a separate phase without architectural changes. |
| 7 | Focus tools injection | **AdditionalTools (per-call), not MCP** | Focus tools are ephemeral per-generate, need local handler routing. AdditionalTool type added to LOFT core. |
| 8 | Type coercion | **Coerce LLM string args to declared types** | LLM tool args arrive as strings. FocusTypeCoercion handles string → number/boolean/date/enum conversion with validation. |
| 9 | Team context isolation | **Fresh SharedContext per team, no parent passthrough** | Simplest correct model. Data flows in via message, not context leaking. Prevents accidental coupling between team internals and parent graph. |
| 10 | Team system prompt storage | **SharedContext key (`__team.systemPrompt`), not AgentMessage** | Stored in internal context so internal nodes can read it. Avoids modifying the orchestrator's message-passing contract. |
| 11 | Orchestrator externalContext | **Optional 3rd parameter on `run()`** | Backward-compatible addition. TeamNode injects its isolated context; callers without a team don't pass it and get the default fresh context. |
| 12 | Policy configuration scope | **Orchestrator-level, not node-level** | Policies (retry, timeout) are orchestration concerns. Configured via `OrchestratorBuilder.addNode(node, policy)`. Keeps Node interface unchanged — same node can have different policies in different orchestrators. |
| 13 | ErrorStrategy type | **Enum, not string union** | `enum ErrorStrategy { FAIL_FAST, CONTINUE }` in loft-definitions/Agent.ts. Enums are the project convention for fixed value sets. |
| 14 | withRetry return type | **`RetryResult<T>` with `{ result, retryCount }`** | Caller needs the actual retry count for metrics. Returning only `T` would lose this information, forcing the caller to track retries externally. |
| 15 | Cycle detection behavior | **Advisory-only (warning, not error)** | Some cycles are intentional (e.g., Focus retry loops). Hard errors would break valid workflows. Logs a warning when a repeating pattern is detected in the node sequence. |
