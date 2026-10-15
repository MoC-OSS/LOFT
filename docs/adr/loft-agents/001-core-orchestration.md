# ADR-001: Core Orchestration — State Machine with Explicit Transitions

## Status

Accepted

## Context

LOFT is a single-agent framework — one LLM call per request. We needed a multi-agent execution engine where specialized agents run in a defined order with branching, parallelism, and depth limits, built on top of LOFT without modifying its core.

The orchestration layer must:
- Support sequential, parallel, and conditional execution
- Allow LLM-driven routing decisions
- Prevent infinite loops
- Be testable with mock nodes (no LLM required)

## Decision

Node-based directed graph with explicit transition definitions. The Orchestrator runs a transition loop: execute entry node → while transition is not TERMINAL, follow the transition to the next node.

### Node Interface

```typescript
// packages/loft-definitions/src/shared/components/Agent.ts:93-97
export interface Node {
  readonly name: string;
  readonly transitions: TransitionDef[];
  run(message: AgentMessage, sharedContext: SharedContextInterface, sessionId: string): Promise<NodeResult>;
}
```

Minimal surface — three properties. No lifecycle hooks, no init/cleanup. Encourages composition over inheritance.

### Transition Types

```typescript
// packages/loft-definitions/src/shared/components/Agent.ts:67-77
export enum TransitionType {
  SINGLE = 'SINGLE',
  FAN_OUT = 'FAN_OUT',
  TERMINAL = 'TERMINAL'
}

export type Transition = TransitionSingle | TransitionFanOut | TransitionTerminal;
```

- `SINGLE` — deterministic next node
- `FAN_OUT` — parallel execution of multiple nodes via `Promise.allSettled()`
- `TERMINAL` — end of the graph

### Orchestrator Loop

```typescript
// packages/loft-agents/src/core/Orchestrator.ts:48-91
let result = await this.executeNode(entryNode, message, sharedContext, ...);
depth++;

while (result.transition.type !== Agent.TransitionType.TERMINAL) {
  if (depth >= this.maxDepth) {
    throw new MaxDepthExceededError(this.maxDepth);
  }

  if (result.transition.type === Agent.TransitionType.SINGLE) {
    const nextNode = this.getNode(result.transition.target);
    result = await this.executeNode(nextNode, result.output, sharedContext, ...);
    depth++;
  } else if (result.transition.type === Agent.TransitionType.FAN_OUT) {
    result = await this.executeFanOut(result.transition.targets, result.output, ...);
    depth++;
  }
}

return result.output;
```

### Transition Resolver

Optional callback that inspects LLM output and chooses the transition:

```typescript
// packages/loft-definitions/src/shared/components/Agent.ts:103
export type TransitionResolver = (result: Chat.GenerateResult, transitions: TransitionDef[]) => Transition;
```

Default resolver in LoftAgentNode:
- 0 transitions → `TERMINAL`
- 1 transition → use it (if `target: null` → `TERMINAL`)
- 2+ transitions → throw `InvalidGraphError` (forces developer to provide a resolver)

```typescript
// packages/loft-agents/src/core/LoftAgentNode.ts:191-205
private static defaultTransitionResolver(
  _result: Chat.GenerateResult,
  transitions: Agent.TransitionDef[]
): Agent.Transition {
  if (transitions.length === 0) return { type: Agent.TransitionType.TERMINAL };
  if (transitions.length === 1) {
    const def = transitions[0];
    if (def.target === null) return { type: Agent.TransitionType.TERMINAL };
    return { type: Agent.TransitionType.SINGLE, target: def.target };
  }
  throw new InvalidGraphError(
    `Ambiguous transition: node has ${transitions.length} transitions but no transitionResolver`
  );
}
```

### Build-Time Validation

```typescript
// packages/loft-agents/src/core/OrchestratorBuilder.ts
build(): Orchestrator {
  // Validates: entry node exists, all transition targets exist,
  // warns if FAN_OUT targets a Focus node
}
```

### FAN_OUT Convergence

```
// packages/loft-agents/src/core/Orchestrator.ts:168-189
// After Promise.allSettled():
// - If all branches point to same SINGLE target → converge there
// - If all branches are TERMINAL → return last result
// - Otherwise → return last fulfilled result
```

## Alternatives Considered

### State Machines (XState-style)
- Rigid state definitions don't map well to LLM outputs where content determines routing
- Overkill for linear pipelines, which are the common case

### Reactive / Actor Model
- Implicit message-passing makes debugging multi-agent flows difficult
- Hard to reason about execution order and depth limits
- Tracing becomes complex with fire-and-forget patterns

### Pure DAGs (no loops)
- Can't support re-ask patterns (Focus needs multiple turns at the same node)
- Can't support retry-at-node-level without graph restructuring

## Consequences

### Positive
- Explicit transitions make orchestration logic testable and auditable
- Graph is inspectable at build time — invalid configurations caught early
- Optional resolvers enable LLM-driven routing without coupling to specific outputs
- Mock nodes make unit testing trivial (no LLM calls needed)

### Negative
- Developers must define transitions explicitly — no automatic routing inference
- FAN_OUT convergence logic is simplistic (last result wins if targets disagree)
- Depth limit is global, not per-subgraph

## References

- `packages/loft-agents/src/core/Orchestrator.ts`
- `packages/loft-agents/src/core/OrchestratorBuilder.ts`
- `packages/loft-agents/src/core/LoftAgentNode.ts` (default resolver)
- `packages/loft-definitions/src/shared/components/Agent.ts` (Node, Transition types)
- `packages/loft-agents/src/__tests__/unit/Orchestrator.test.ts`
- `packages/loft-agents/src/__tests__/unit/OrchestratorBuilder.test.ts`
