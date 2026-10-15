# @moc-global/loft-agents

Multi-agent workflows on top of [LOFT](https://github.com/MoC-OSS/LOFT). Each agent is a node that makes one LOFT `generate()` call with its own manifest; transitions connect the nodes into a graph. The package adds parallel fan-out, teams (sub-graphs that act as one node), retry and timeout policies, tracing and metrics. Focus, for collecting structured data over several turns, comes from `@moc-global/loft` and is re-exported here.

## Install

```bash
npm install @moc-global/loft-agents
```

Its peers, `@moc-global/loft` and `@moc-global/loft-definitions`, are already in a LOFT application.

## Usage

A classifier routes each message to a billing or a support agent. Each `manifestName` is a manifest in your manifest file, and `llmName` a registered LLM strategy:

```typescript
import { LOFT } from '@moc-global/loft';
import { LoftAgentNode, OrchestratorBuilder } from '@moc-global/loft-agents';
import { Agent, Chat } from '@moc-global/loft-definitions';

export function buildRouter(loft: LOFT<Chat.ChatInterface>) {
  const classifier = new LoftAgentNode({
    name: 'classifier',
    loft,
    llmName: 'claude-sonnet',
    manifestName: 'classifier',
    transitions: [
      { name: 'to-billing', description: 'Billing question', target: 'billing' },
      { name: 'to-support', description: 'Anything else', target: 'support' }
    ],
    // With more than one transition, the resolver picks the next node from the LLM's answer
    transitionResolver: (result) => {
      const answer = result.messages.llmResponse.topChoice.content
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('');
      return { type: Agent.TransitionType.SINGLE, target: answer.includes('billing') ? 'billing' : 'support' };
    }
  });
  // No transitions: the graph ends at these nodes
  const billing = new LoftAgentNode({ name: 'billing', loft, llmName: 'claude-sonnet', manifestName: 'billing', transitions: [] });
  const support = new LoftAgentNode({ name: 'support', loft, llmName: 'claude-sonnet', manifestName: 'support', transitions: [] });

  return new OrchestratorBuilder()
    .addNode(classifier)
    .addNode(billing)
    .addNode(support)
    .setEntry('classifier')
    .setMaxDepth(10)
    .build();
}

export async function answer(loft: LOFT<Chat.ChatInterface>, sessionId: string, text: string) {
  const reply = await buildRouter(loft).run({ role: Agent.AgentMessageRole.USER, content: text }, sessionId);
  return reply.content;
}
```

## Main exports

| Export | What it does |
| --- | --- |
| `LoftAgentNode` | A node that calls `loft.chat.generate()` with its own manifest and chooses the next node |
| `OrchestratorBuilder`, `Orchestrator` | Build and run the graph: entry node, depth limit, error strategy, cycle detection, tracer, metrics |
| `TeamBuilder`, `TeamNode` | A sub-graph used as one node |
| `SharedContext`, `ScopedContext` | Data the nodes of one run share, including each `LoftAgentNode`'s answer under its name |
| `withRetry`, `withTimeout` | Retry and timeout policies, also settable per node with `addNode(node, policy)` |
| `MetricsCollector` | Per-node timings and token usage |
| `FocusRegistry`, `InMemoryFocusStateStore` and the Focus helpers | Structured data collection, re-exported from `@moc-global/loft` |
| `AgentError` and its subclasses | `MaxDepthExceededError`, `NodeNotFoundError`, `NodeTimeoutError`, `NodeRetryExhaustedError`, `FanOutPartialError` and others |

## Documentation

- [Agent orchestration guide](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/agents.md): nodes, fan-out, teams, Focus, production settings
- [Agent concepts](https://github.com/MoC-OSS/LOFT/blob/main/docs/concepts/agents/README.md)
- [express-agents example](https://github.com/MoC-OSS/LOFT/tree/main/examples/express-agents) and [express-focus-basic example](https://github.com/MoC-OSS/LOFT/tree/main/examples/express-focus-basic)

## License

[MIT](./LICENSE)
