# Agent Orchestration (`@moc-global/loft-agents`)

Multi-agent orchestration layer on top of LOFT. Agents share a single LOFT instance — each agent uses the same DI container but references its own manifest (system prompt, model preset) via `manifestName`. The orchestrator composes agents into sequential, parallel, and team-based workflows.

## Reading Order

| # | Document | What it covers |
|---|----------|----------------|
| 1 | [Design](./design.md) | Architecture, concepts, implementation decisions |
| 2 | [Flow Diagrams](./flow-diagrams.md) | Mermaid diagrams of execution flows (sequential, fan-out, node detail) |
| 3 | [Reference Concepts](./reference-concepts.md) | External reference: agent interaction patterns from betonbrut library |
| 4 | [Excalidraw Diagram](./agent-flow-diagram.excalidraw) | Visual diagram (open with excalidraw.com) |
| 5 | [Guide: Building Agents](../../guides/agents.md) | Step-by-step guide with examples |
| 6 | [Example: Restaurant Agent Showcase](../../../examples/express-agents/) | Runnable Express example: an LLM router and five pipelines that cover all features |

## Key Concepts

- **Shared LOFT instance**: All agents use the same `LOFT` instance. Each agent specifies a `manifestName` to get a different system prompt and model preset. No per-agent LOFT setup required.
- **Agent graph**: Nodes connected by transitions. The orchestrator walks the graph based on transition resolvers.
- **SharedContext**: Key-value store passed through all nodes. Agents read upstream data and write results for downstream agents.
- **Focus**: Structured data collection across multiple turns. Fields are validated, coerced, and tracked. Available standalone from `@moc-global/loft` (no orchestrator required).
- **Teams**: Encapsulated sub-graphs with their own isolated SharedContext. The parent graph sees the team as a single node.

## Quick Reference

### Basic Orchestration

```typescript
import { LoftAgentNode, OrchestratorBuilder } from '@moc-global/loft-agents';
import { Agent } from '@moc-global/loft-definitions';

// All agents share a single LOFT instance — different manifestName per role
const router = new LoftAgentNode({
  name: 'router',
  loft,
  llmName: 'claude-sonnet-5-5',
  manifestName: 'router-manifest',
  transitions: [
    { name: 'billing', description: 'Route to billing', target: 'billing-agent' },
    { name: 'support', description: 'Route to support', target: 'support-agent' }
  ],
  transitionResolver: myCustomResolver
});

const orchestrator = new OrchestratorBuilder()
  .addNode(router)
  .addNode(billingAgent)
  .addNode(supportAgent)
  .setEntry('router')
  .setMaxDepth(10)
  .build();

const result = await orchestrator.run(
  { role: Agent.AgentMessageRole.USER, content: 'I have a billing question' },
  sessionId
);
```

### Focus (Structured Data Collection)

Focus is a LOFT-level capability — registered on the LOFT instance and handled inside `generate()`. Focus is bound to sessions at creation time and auto-deactivates when all fields are collected.

```typescript
import { LoftAgentNode } from '@moc-global/loft-agents';
import { Agent } from '@moc-global/loft-definitions';

// Register Focus config on LOFT instance
loft.registerFocus('intake', {
  agentName: 'intake',
  prompt: 'Collect vehicle insurance information from the user.',
  fields: [
    { key: 'vehicleType', type: Agent.FocusFieldType.STRING, required: true, description: 'Vehicle make and model' },
    { key: 'year', type: Agent.FocusFieldType.NUMBER, required: true, description: 'Vehicle year' },
    { key: 'coverage', type: Agent.FocusFieldType.ENUM, required: true, description: 'Coverage level',
      values: ['basic', 'standard', 'premium'] }
  ],
  onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'quote-agent' }
});

// Bind Focus to session at creation time
const session = await loft.chat.createSession({
  currentLlmName: 'claude-sonnet-5-5',
  currentManifestName: 'intake-manifest',
  externalKey: {},
  focusAgent: 'intake'  // auto-activates on every generate(), auto-deactivates when complete
});

// Agent doesn't specify focusAgent — it comes from the session
// (pass focusName: 'intake' instead to make this node always collect that Focus)
const intakeAgent = new LoftAgentNode({
  name: 'intake',
  loft,
  llmName: 'claude-sonnet-5-5',
  manifestName: 'intake-manifest',
  transitions: [],
  onFocusComplete: { type: Agent.FocusActionType.TRANSITION, target: 'quote-agent' }
});
```

### FAN_OUT (Parallel Execution)

Use a custom `transitionResolver` to dispatch to multiple agents simultaneously:

```typescript
const dispatcher = new LoftAgentNode({
  name: 'dispatcher',
  loft,
  llmName: 'claude-sonnet-5-5',
  manifestName: 'dispatcher-manifest',
  transitions: [
    { name: 'flights', description: 'Search flights', target: 'flights-agent' },
    { name: 'hotels', description: 'Search hotels', target: 'hotels-agent' },
    { name: 'activities', description: 'Find activities', target: 'activities-agent' }
  ],
  transitionResolver: () => ({
    type: Agent.TransitionType.FAN_OUT,
    targets: ['flights-agent', 'hotels-agent', 'activities-agent']
  })
});
```

FAN_OUT agents run in parallel. Their results converge into the next sequential node.

### Team (Encapsulated Sub-Graph)

```typescript
import { TeamBuilder, OrchestratorBuilder } from '@moc-global/loft-agents';

const reviewTeam = new TeamBuilder('review-team')
  .systemPrompt('You are a content review team.')
  .addNode(factChecker)
  .addNode(toneChecker)
  .addNode(synthesis)
  .setEntry('fact-checker')
  .addTransition({ name: 'done', description: 'Review complete', target: 'publisher' })
  .build();

// Use team as a regular node in the parent orchestrator
const orchestrator = new OrchestratorBuilder()
  .addNode(writer)
  .addNode(reviewTeam)   // TeamNode implements Agent.Node
  .addNode(publisher)
  .setEntry('writer')
  .build();

// Parent SharedContext is fully isolated from team internals
const result = await orchestrator.run(message, sessionId);
```

### Production Hardening (Retry, Timeout, Tracing, Metrics)

```typescript
import { OrchestratorBuilder } from '@moc-global/loft-agents';
import { Agent } from '@moc-global/loft-definitions';

const orchestrator = new OrchestratorBuilder()
  .addNode(router)
  .addNode(expert, {
    retry: { maxRetries: 3, delayMs: 1000, backoffMultiplier: 2 },
    timeout: { timeoutMs: 30000 }
  })
  .addNode(critic, {
    timeout: { timeoutMs: 15000 }
  })
  .setEntry('router')
  .setErrorStrategy(Agent.ErrorStrategy.CONTINUE)  // Partial FanOut results
  .setTracer(tracer)                                // LOFT TracerFactory tracer
  .setMetricsCallback((metrics) => {
    console.log(`Duration: ${metrics.orchestratorDurationMs}ms`);
    console.log(`Path: ${metrics.transitionPath.join(' → ')}`);
    for (const node of metrics.nodeMetrics) {
      console.log(`  ${node.nodeName}: ${node.durationMs}ms, retries: ${node.retryCount}`);
      if (node.usage) console.log(`    tokens: ${node.usage.totalTokens}`);
    }
  })
  .setCycleDetection(true)
  .build();

const result = await orchestrator.run(message, sessionId);
```
