# ADR-005: SharedContext — Inter-Agent Key-Value Store with Deep Copy Safety

## Status

Accepted

## Context

Agents in an orchestrator need to share data — Focus results flow to downstream agents, fan-out error info must be visible to convergence nodes, teams need internal prompts. But mutable shared state is dangerous — one agent could accidentally mutate another's data through object references.

Requirements:
- Simple read/write access for any agent in the graph
- Safe against accidental cross-agent mutation
- Serializable for LLM consumption (injected as text)
- Scoping support for agent-specific namespacing

## Decision

Session-scoped `Map<string, unknown>` with `structuredClone()` on every `get()`. Optional prefix-based scoping via `ScopedContext`.

### SharedContext

```typescript
// packages/loft-agents/src/core/SharedContext.ts:18-46
export class SharedContext implements Agent.SharedContextInterface {
  public readonly sessionId: string;
  private readonly store = new Map<string, unknown>();

  get<T = unknown>(key: string): T | undefined {
    const value = this.store.get(key);
    return value !== undefined ? structuredClone(value) as T : undefined;
  }

  set<T = unknown>(key: string, value: T): void {
    this.store.set(key, value);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  keys(): string[] {
    return [...this.store.keys()];
  }

  for(agentName: string): Agent.SharedContextInterface {
    return new ScopedContext(this, agentName);
  }
}
```

### Deep Copy on Read

Every `get()` returns `structuredClone(value)` — prevents cross-agent mutation:

```typescript
// Agent A writes an object
sharedContext.set('results', { flights: [...] });

// Agent B reads it — gets an independent copy
const data = sharedContext.get('results');
data.flights.push(extra);  // does NOT affect Agent A's original
```

`set()` stores as-is (no clone) — the writer owns the reference until someone reads it.

### ScopedContext

Lightweight wrapper for agent-specific namespacing:

```typescript
// packages/loft-agents/src/core/SharedContext.ts:3-16
class ScopedContext implements Agent.SharedContextInterface {
  constructor(
    private readonly parent: SharedContext,
    private readonly prefix: string
  ) {}

  get<T>(key: string): T | undefined {
    return this.parent.get(`${this.prefix}.${key}`);
  }

  set<T>(key: string, value: T): void {
    this.parent.set(`${this.prefix}.${key}`, value);
  }
  // ... delete, keys (filtered by prefix), for (nested scope)
}
```

Usage:
```typescript
const agentCtx = sharedContext.for('flights');
agentCtx.set('options', flightList);     // stored as "flights.options"
agentCtx.get('options');                  // reads "flights.options"
```

### SharedContext → LLM Text

LoftAgentNode serializes the entire SharedContext as a JSON system message:

```typescript
// packages/loft-agents/src/core/LoftAgentNode.ts:137-163
private sharedContextToAugmentedMessages(sharedContext, sessionId): CreateMessage[] {
  const keys = sharedContext.keys();
  if (keys.length === 0) return [];

  const contextData: Record<string, unknown> = {};
  for (const key of keys) {
    contextData[key] = sharedContext.get(key);
  }

  return [{
    sessionId,
    content: [{ type: 'text', text: JSON.stringify(contextData) }],
    role: UnifiedMessageRole.system,
    author: 'orchestrator',
    ...
  }];
}
```

All keys are visible to the LLM as read-only text. The LLM cannot modify SharedContext directly.

### Key Conventions

| Key | Written by | Purpose |
|-----|-----------|---------|
| `focus:<agentName>` | LoftAgentNode (on Focus complete) | Collected focus data for downstream agents |
| `__fanout.rejected` | Orchestrator (ErrorStrategy.CONTINUE) | Fan-out rejection details `[{nodeName, error}]` |
| `__team.systemPrompt` | TeamNode (internal context) | Team-level instructions for internal agents |

### Data Flow Patterns

```
Focus Node (intake)
  │ writes: focus:intake = {destination: "Barcelona", budget: 3000, ...}
  │
  ▼
Dispatcher
  │ reads: SharedContext → JSON system message → LLM sees focus data
  │
  ▼
FAN_OUT → [flights, hotels, activities]
  │ each reads SharedContext independently (deep copies)
  │ if one fails + CONTINUE: __fanout.rejected written
  │
  ▼
Planning Team (isolated — NEW SharedContext)
  │ does NOT see parent SharedContext
  │ only receives input message from parent
  │
  ▼
Response Node
  │ reads SharedContext (focus data + any fan-out info)
```

### Team Isolation

Teams create a new `SharedContext(sessionId)` on each run (see ADR-003). Parent context is not passed in:

```typescript
// packages/loft-agents/src/team/TeamNode.ts:33
const teamContext = new SharedContext(sessionId);
```

This prevents internal team state from leaking to the parent graph and vice versa.

## Alternatives Considered

### Message-Passing Only
- Each node receives only the previous node's output message
- Rejected: Loses cumulative state across fan-out branches; flights/hotels/activities results can't merge without a shared store

### Shared Object References (No Clone)
- Store and return the same object reference
- Rejected: Unsafe — mutations in one agent silently affect others; hard to debug in parallel fan-out execution

### Typed Context Objects
- Generic `SharedContext<T>` with typed keys
- Rejected: Complex generics per orchestrator configuration; hard to extend when agents add keys dynamically; over-engineering for a KV store

### Immutable Context (Copy-on-Write)
- Return new context instance on every write
- Rejected: Incompatible with fan-out (parallel agents need to write to same context); adds complexity without clear benefit over deep-copy-on-read

## Consequences

### Positive
- Simple API — `get`/`set`/`delete`/`keys` covers all use cases
- Deep copy on read prevents accidental cross-agent mutation
- JSON-serializable — naturally converts to LLM-consumable text
- Scoped access prevents key collisions between agents
- Team isolation prevents accidental state coupling

### Negative
- `structuredClone()` on every read is expensive for large objects
- No typed access — consumers must know the value shape (cast via `get<T>`)
- All keys visible to all agents in the same orchestrator (no per-agent ACLs)
- Context grows unbounded — no automatic cleanup of stale keys

## References

- `packages/loft-agents/src/core/SharedContext.ts`
- `packages/loft-agents/src/core/LoftAgentNode.ts` (sharedContextToAugmentedMessages, lines 137-163)
- `packages/loft-agents/src/core/LoftAgentNode.ts` (focus → SharedContext write, line 110)
- `packages/loft-agents/src/core/Orchestrator.ts` (fan-out rejection write, line 149)
- `packages/loft-agents/src/team/TeamNode.ts` (team isolation, line 33)
- `packages/loft-definitions/src/shared/components/Agent.ts` (SharedContextInterface)
- `packages/loft-agents/src/__tests__/unit/SharedContext.test.ts`
