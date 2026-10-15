# loft-agents — Architecture Decision Records

Multi-agent orchestration layer built on top of the LOFT framework.

```
intake (Focus) → dispatcher (FAN_OUT) → [flights, hotels, activities] → planning-team (Team) → response
```

## ADR Index

| ADR | Decision | Status |
|-----|----------|--------|
| [001](001-core-orchestration.md) | Core Orchestration — State machine with explicit transitions | Accepted |
| [002](002-focus-structured-collection.md) | Focus — Tool-driven structured data collection | Accepted |
| [003](003-team-encapsulation.md) | Team Encapsulation — Nested orchestrators with context isolation | Accepted |
| [004](004-production-hardening.md) | Production Hardening — Retry, timeout, error strategy, cycle detection | Accepted |
| [005](005-shared-context.md) | SharedContext — Inter-agent KV store with deep copy safety | Accepted |
| [006](006-loft-agent-node-adapter.md) | LoftAgentNode — LOFT Chat adapter to Agent.Node interface | Accepted |

## Key Source Files

- `packages/loft-agents/src/core/` — Orchestrator, OrchestratorBuilder, LoftAgentNode, SharedContext
- `packages/loft-agents/src/focus/` — Focus tools, status, coercion, prompt generation
- `packages/loft-agents/src/team/` — TeamBuilder, TeamNode
- `packages/loft-agents/src/policies/` — RetryPolicy, TimeoutPolicy
- `packages/loft-agents/src/observability/` — Metrics, TracingIntegration
- `packages/loft-definitions/src/shared/components/Agent.ts` — All type definitions
