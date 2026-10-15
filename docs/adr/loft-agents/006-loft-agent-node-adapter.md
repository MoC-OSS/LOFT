# ADR-006: LoftAgentNode — LOFT Chat Adapter to Agent.Node Interface

## Status

Accepted

## Context

The `Agent.Node` interface is LOFT-framework-agnostic — any async function can implement it. But the primary use case is wrapping LOFT's `chat.generate()`. We need an adapter that bridges LOFT's chat protocol (sessions, manifests, middleware, tools) with the orchestrator's node protocol (messages, transitions, SharedContext).

The adapter must:
- Translate `AgentMessage` to/from LOFT's `CreateMessage` / `GenerateResult`
- Ensure each node uses its own manifest and LLM config (not the session default)
- Support optional Focus integration without complicating non-Focus nodes
- Expose token usage metrics for the orchestrator's metrics system

## Decision

Composition-based adapter. `LoftAgentNode` holds a `LOFT<ChatInterface>` instance and translates between the two protocols. Uses `temporaryManifestName` / `temporaryLlmName` so each node resolves its own manifest rather than falling back to the session's default.

### Class Overview

```typescript
// packages/loft-agents/src/core/LoftAgentNode.ts:9
export class LoftAgentNode implements Agent.Node, Agent.FocusAware, Agent.NodeMetricsAware {
  public readonly name: string;
  public readonly transitions: Agent.TransitionDef[];

  private readonly loft: LOFT<Chat.ChatInterface>;
  private readonly llmName: string;
  private readonly manifestName: string;
  private readonly transitionResolver: Agent.TransitionResolver;
  private readonly focusConfig?: Agent.Focus;
  private readonly focusStateStore?: Agent.FocusStateStore;
  private lastMetrics?: { usage: Agent.NodeUsageMetrics };
}
```

### Execution Flow

```typescript
// packages/loft-agents/src/core/LoftAgentNode.ts:53-120
async run(message, sharedContext, sessionId): Promise<Agent.NodeResult> {
  // 1. Convert AgentMessage → LOFT CreateMessage[]
  const directMessages = this.toCreateMessages(message, sessionId);

  // 2. Serialize SharedContext → augmented system messages
  const augmentedContext = this.sharedContextToAugmentedMessages(sharedContext, sessionId);

  // 3. If Focus: inject prompt + generate tools
  if (this.focusConfig) { /* ... */ }

  // 4. Call LOFT with node-specific manifest
  const result = await this.loft.chat.generate({
    sessionId,
    directMessages,
    augmentedContext,
    additionalTools,
    temporaryLlmName: this.llmName,
    temporaryManifestName: this.manifestName
  });

  // 5. Extract text → AgentMessage
  const output = this.toAgentMessage(result);

  // 6. Resolve transition
  const transition = this.transitionResolver(result, this.transitions);

  // 7. If Focus ready: write to SharedContext, override transition
  if (this.focusConfig && status.ready) { /* ... */ }

  return { output, transition };
}
```

### Protocol Translation

**Input: AgentMessage → CreateMessage[]**

```typescript
// packages/loft-agents/src/core/LoftAgentNode.ts:122-135
private toCreateMessages(message: Agent.AgentMessage, sessionId: string): Type.Entity.CreateMessage[] {
  return [{
    sessionId,
    content: [{ type: 'text', text: message.content }],
    role: this.mapRole(message.role),  // USER → user, ASSISTANT → assistant, SYSTEM → system
    author: 'agent',
    llmName: this.llmName,
    manifestName: this.manifestName,
    llmIgnore: false,
    ctx: message.data ?? {}
  }];
}
```

**Output: GenerateResult → AgentMessage**

```typescript
// packages/loft-agents/src/core/LoftAgentNode.ts:165-175
private toAgentMessage(result: Chat.GenerateResult): Agent.AgentMessage {
  const topChoice = result.messages.llmResponse.topChoice;
  const textParts = topChoice.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text);

  return {
    role: Agent.AgentMessageRole.ASSISTANT,
    content: textParts.join('')
  };
}
```

Only `text` content parts are extracted. Tool-use blocks are filtered out — they are handled by LOFT's tool execution loop internally.

### Per-Node Manifest Resolution

Each node passes `temporaryLlmName` and `temporaryManifestName` to `chat.generate()`:

```typescript
// packages/loft-agents/src/core/LoftAgentNode.ts:84-89
const result = await this.loft.chat.generate({
  sessionId,
  directMessages,
  augmentedContext,
  additionalTools,
  temporaryLlmName: this.llmName,
  temporaryManifestName: this.manifestName
});
```

Without these, LOFT falls back to `ctx.session.currentManifestName` — which is the session's default (typically the first agent's manifest). This caused a bug where all agents used the intake manifest. The `temporary*` parameters override per-request without changing the session.

```
// packages/loft/src/workflows/chat/BaseLoftChat.ts:356-357
const effectiveLlmName = temporaryRequestConfig.llmName || ctx.session.currentLlmName;
const effectiveManifestName = temporaryRequestConfig.manifestName || ctx.session.currentManifestName;
```

### Optional Traits (Duck-Typed)

Traits are checked at runtime via `in` operator — no forced inheritance:

**FocusAware:**
```typescript
// packages/loft-definitions/src/shared/components/Agent.ts:105-107
export interface FocusAware {
  focus(): Focus | undefined;
}

// OrchestratorBuilder checks this for FAN_OUT validation
```

**NodeMetricsAware:**
```typescript
// packages/loft-definitions/src/shared/components/Agent.ts:109-111
export interface NodeMetricsAware {
  getLastMetrics(): { usage: NodeUsageMetrics } | undefined;
}

// Orchestrator checks at runtime:
// packages/loft-agents/src/core/Orchestrator.ts:237-243
if (metrics && 'getLastMetrics' in node) {
  const metricsAware = node as Agent.NodeMetricsAware;
  const nodeMetrics = metricsAware.getLastMetrics();
  if (nodeMetrics) {
    metrics.recordUsage(node.name, nodeMetrics.usage);
  }
}
```

Token usage captured after each generate call:

```typescript
// packages/loft-agents/src/core/LoftAgentNode.ts:91-100
const usage = result.messages.llmResponse.usage;
this.lastMetrics = {
  usage: {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    totalCost: usage.totalCost,
    model: usage.model
  }
};
```

### SharedContext → LLM

SharedContext is serialized as a JSON system message so the LLM can read inter-agent data:

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
    content: [{ type: 'text', text: JSON.stringify(contextData) }],
    role: UnifiedMessageRole.system,
    author: 'orchestrator',
    ...
  }];
}
```

### Non-LOFT Agents

The `Agent.Node` interface is minimal — any async function can implement it without LoftAgentNode:

```typescript
// Custom node example (no LOFT dependency)
const customNode: Agent.Node = {
  name: 'api-caller',
  transitions: [{ name: 'done', description: 'API called', target: 'next' }],
  async run(message, sharedContext, sessionId) {
    const data = await fetch('https://api.example.com/...');
    return {
      output: { role: Agent.AgentMessageRole.ASSISTANT, content: JSON.stringify(data) },
      transition: { type: Agent.TransitionType.SINGLE, target: 'next' }
    };
  }
};
```

## Alternatives Considered

### Inheritance from AbstractLoftLLM
- Extend the base LLM class to add orchestration logic
- Rejected: Circular generics (AbstractLoftLLM has generic type parameters that conflict with Agent.Node); couples agent logic to LLM strategy internals

### Separate Router Class
- A dedicated class that maps LLM output to transitions, separate from the node
- Rejected: Extra indirection for simple cases; most nodes have 0-1 transitions where the default resolver suffices

### Inline Orchestration Logic
- Each agent manually calls `loft.chat.generate()` and returns transitions
- Rejected: Not reusable; boilerplate per agent; no consistent metrics/tracing integration

## Consequences

### Positive
- Clean separation: LOFT protocol ↔ Agent protocol via a single adapter class
- Per-node manifest resolution eliminates shared-session manifest conflicts
- Optional traits (FocusAware, NodeMetricsAware) avoid forced inheritance
- Non-LOFT agents can implement `Agent.Node` directly — framework is not locked in
- Token usage metrics captured automatically for every LOFT-based node

### Negative
- LoftAgentNode couples to LOFT's chat protocol (`generate()`, `CreateMessage`, `GenerateResult`)
- All agents in one orchestrator share the same session's chat history (can cause LLM confusion with long conversations)
- `toAgentMessage` drops non-text content (tool-use blocks, images) — only text flows between nodes
- SharedContext serialized as one JSON blob — large contexts increase LLM input tokens

## References

- `packages/loft-agents/src/core/LoftAgentNode.ts`
- `packages/loft/src/workflows/chat/BaseLoftChat.ts` (temporaryManifestName resolution, lines 356-357)
- `packages/loft-definitions/src/shared/components/Agent.ts` (Node, FocusAware, NodeMetricsAware)
- `packages/loft-definitions/src/shared/components/Chat.ts` (GenerateOptions, GenerateResult)
- `packages/loft-agents/src/__tests__/unit/LoftAgentNode.test.ts`
