# ADR-003: Team Encapsulation — Nested Orchestrators with Context Isolation

## Status

Accepted

## Context

Some tasks require multiple agents working as a unit — for example, an itinerary-builder creates a day-by-day plan, then a budget-optimizer reviews costs and suggests adjustments. The parent orchestrator shouldn't know or manage internal team topology. Teams should be:

- Composable — plug a team into any graph as a single node
- Isolated — internal state doesn't leak to the parent
- Reusable — same team definition usable in different orchestrators

## Decision

`TeamNode` implements `Agent.Node` and wraps a private `Orchestrator` instance. The parent graph sees it as a single node. Each team run creates a new `SharedContext` — intentional isolation so internal state doesn't leak outward.

### TeamNode

```typescript
// packages/loft-agents/src/team/TeamNode.ts:5-60
export class TeamNode implements Agent.Node {
  public readonly name: string;
  public readonly transitions: Agent.TransitionDef[];

  private readonly orchestrator: Orchestrator;
  private readonly systemPrompt?: string;

  async run(
    message: Agent.AgentMessage,
    _sharedContext: Agent.SharedContextInterface,  // parent context — NOT passed to team
    sessionId: string
  ): Promise<Agent.NodeResult> {
    // Create NEW context — intentional isolation
    const teamContext = new SharedContext(sessionId);

    if (this.systemPrompt) {
      teamContext.set('__team.systemPrompt', this.systemPrompt);
    }

    // Delegate to nested orchestrator
    const output = await this.orchestrator.run(message, sessionId, teamContext);

    // Resolve team's own transition for parent graph
    const transition = this.resolveTransition();
    return { output, transition };
  }
}
```

### TeamBuilder

Fluent wrapper around `OrchestratorBuilder` for the sub-graph:

```typescript
// packages/loft-agents/src/team/TeamBuilder.ts:6-51
export class TeamBuilder {
  constructor(private readonly teamName: string) {}

  systemPrompt(prompt: string): this { ... }
  addNode(node: Agent.Node): this { ... }
  setEntry(name: string): this { ... }
  setMaxDepth(depth: number): this { ... }
  addTransition(def: Agent.TransitionDef): this { ... }

  build(): TeamNode {
    const orchestrator = this.builder.build();
    return new TeamNode(this.teamName, orchestrator, this.transitions, this.prompt);
  }
}
```

### Example: Planning Team

```typescript
// examples/express-agents/src/loft/agents/planning-team.ts
export function createPlanningTeam(loft: LOFT<Chat.ChatInterface>): TeamNode {
  const itineraryBuilder = new LoftAgentNode({
    name: 'itinerary-builder',
    manifestName: 'travel-itinerary',
    transitions: [{ name: 'to-budget', target: 'budget-optimizer' }]
  });

  const budgetOptimizer = new LoftAgentNode({
    name: 'budget-optimizer',
    manifestName: 'travel-budget',
    transitions: []  // terminal within team
  });

  return new TeamBuilder('planning-team')
    .systemPrompt('You are a travel planning team...')
    .addNode(itineraryBuilder)
    .addNode(budgetOptimizer)
    .setEntry('itinerary-builder')
    .setMaxDepth(5)
    .addTransition({ name: 'to-response', target: 'response' })
    .build();
}
```

### Data Flow

```
Parent Orchestrator
  │
  ├── node.dispatcher
  ├── orchestrator.fanOut → [flights, hotels, activities]
  │
  ├── node.planning-team  ← TeamNode (single node in parent graph)
  │     │
  │     │  Internal (isolated):
  │     ├── itinerary-builder → budget-optimizer
  │     │   (own SharedContext, own maxDepth)
  │     │
  │     └── Returns: AgentMessage only
  │
  └── node.response
```

| Direction | What passes | What doesn't |
|-----------|-------------|-------------|
| Parent → Team | Input `AgentMessage` | Parent `SharedContext` |
| Team internal | Own `SharedContext` + `__team.systemPrompt` | Parent context, parent metrics |
| Team → Parent | Output `AgentMessage` | Internal context, internal node results |

### Transition Resolution

TeamNode resolves its own transition for the parent graph:

```typescript
// packages/loft-agents/src/team/TeamNode.ts:44-55
private resolveTransition(): Agent.Transition {
  if (this.transitions.length === 0) return { type: Agent.TransitionType.TERMINAL };
  if (this.transitions.length === 1) {
    const def = this.transitions[0];
    if (def.target === null) return { type: Agent.TransitionType.TERMINAL };
    return { type: Agent.TransitionType.SINGLE, target: def.target };
  }
  throw new InvalidGraphError(`Ambiguous transition for team "${this.name}"`);
}
```

## Alternatives Considered

### Flat Graph (No Hierarchy)
- All agents at the same level in one orchestrator
- Rejected: Complex graphs become unmanageable; can't reuse agent groups across different orchestrators

### Shared Context with Teams
- Pass parent SharedContext into the team
- Rejected: Internal state leaks to parent; teams can't be composed independently; naming collisions between internal and external keys

### Event Bus Between Teams
- Teams communicate via pub/sub messages
- Rejected: Loses orchestration control; hard to trace execution order; incompatible with depth-limited transition loop

## Consequences

### Positive
- Teams are transparent to the parent — just another `Agent.Node`
- Context isolation prevents accidental coupling between team internals and parent state
- Teams are reusable — same `TeamBuilder` definition works in any orchestrator
- Internal topology changes don't affect parent graph

### Negative
- Parent cannot inspect or modify internal team state
- All data exchange must be explicit through the output message — no "reaching in"
- Team depth limit is separate from parent depth limit (could lead to unexpected deep execution)
- No inter-team communication without going through the parent orchestrator

## References

- `packages/loft-agents/src/team/TeamNode.ts`
- `packages/loft-agents/src/team/TeamBuilder.ts`
- `packages/loft-agents/src/core/SharedContext.ts`
- `examples/express-agents/src/loft/agents/planning-team.ts`
- `packages/loft-agents/src/__tests__/unit/TeamNode.test.ts`
- `packages/loft-agents/src/__tests__/unit/TeamBuilder.test.ts`
