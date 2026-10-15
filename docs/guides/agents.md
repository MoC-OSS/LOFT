# Agent Orchestration Guide

This guide walks you through building a multi-agent workflow with `@moc-global/loft-agents`. By the end, you'll have agents that collect structured data, run in parallel, and work as teams.

## Install

```bash
pnpm add @moc-global/loft-agents --filter=your-app
```

`@moc-global/loft` and `@moc-global/loft-definitions` are peer dependencies: install them too, plus an LLM strategy.

## Core Idea

Each agent is a **node** in a directed graph. The **orchestrator** runs the graph: it starts at an entry node, follows transitions, and stops when it hits a terminal node.

```
entry → nodeA → nodeB → (terminal)
```

A node receives a message, calls an LLM, and returns an output message + a transition (where to go next).

## 1. Create Agent Nodes

Each `LoftAgentNode` wraps a LOFT chat instance. It needs a name, an LLM name, a manifest name (for the system prompt), and transitions.

```typescript
import { LoftAgentNode } from '@moc-global/loft-agents';

const classifier = new LoftAgentNode({
  name: 'classifier',
  loft,                              // your LOFT instance
  llmName: 'claude-sonnet-5-5',
  manifestName: 'my-classifier',     // maps to a manifest in manifest.json
  transitions: [
    { name: 'to-billing', description: 'Billing question', target: 'billing' },
    { name: 'to-support', description: 'Support question', target: 'support' }
  ],
  transitionResolver: (result, transitions) => {
    // Inspect LLM output and choose a transition
    const text = result.messages.llmResponse.topChoice.content
      .filter(p => p.type === 'text').map(p => p.text).join('');
    const target = text.includes('billing') ? 'billing' : 'support';
    return { type: Agent.TransitionType.SINGLE, target };
  }
});

const billing = new LoftAgentNode({
  name: 'billing',
  loft,
  llmName: 'claude-sonnet-5-5',
  manifestName: 'billing-agent',
  transitions: []  // terminal — no transitions means the graph stops here
});

const support = new LoftAgentNode({
  name: 'support',
  loft,
  llmName: 'claude-sonnet-5-5',
  manifestName: 'support-agent',
  transitions: []
});
```

### Transition Rules

- `transitions: []` → node is terminal (graph stops)
- `transitions: [{ target: 'next' }]` → always go to `next`
- `transitions: [{ target: null }]` → terminal (explicit)
- Multiple transitions → you **must** provide a `transitionResolver`

## 2. Build the Orchestrator

```typescript
import { OrchestratorBuilder } from '@moc-global/loft-agents';
import { Agent } from '@moc-global/loft-definitions';

const orchestrator = new OrchestratorBuilder()
  .addNode(classifier)
  .addNode(billing)
  .addNode(support)
  .setEntry('classifier')
  .setMaxDepth(10)
  .build();
```

## 3. Run It

```typescript
const result = await orchestrator.run(
  { role: Agent.AgentMessageRole.USER, content: 'I have a billing question' },
  sessionId
);

console.log(result.content);  // billing agent's response
```

## 4. Focus — Structured Data Collection

Focus lets an agent collect typed fields from the user across multiple turns. The LLM gets auto-generated tools to store and validate field values.

Focus is a LOFT-level capability — configs are registered on the LOFT instance and the focus logic (prompt injection, tool generation, status computation) runs inside `generate()`. This means Focus works with both plain `loft.chat.generate()` and `LoftAgentNode`.

### Registering Focus on LOFT

```typescript
import { Agent } from '@moc-global/loft-definitions';

const orderFocus: Agent.Focus = {
  agentName: 'intake',
  prompt: 'Collect order details from the user.',
  fields: [
    { key: 'product', type: Agent.FocusFieldType.STRING, required: true, description: 'Product name' },
    { key: 'quantity', type: Agent.FocusFieldType.NUMBER, required: true, description: 'Quantity',
      validate: (v) => Number(v) > 0 ? true : 'Must be positive' },
    { key: 'priority', type: Agent.FocusFieldType.ENUM, required: true, description: 'Priority',
      values: ['low', 'medium', 'high'] }
  ],
  onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'processor' }
};

// Register on LOFT instance — shared across all consumers
loft.registerFocus('intake', orderFocus);
```

### Using Focus with generate()

Pass `focusAgent` in generate options, or bind it to a session at creation time.

```typescript
// Option A: Per-call (useful for plain chat without sessions)
const result = await loft.chat.generate({
  sessionId,
  directMessages,
  focusAgent: 'intake'  // references registered Focus config by name
});

// Option B: Session-level binding (recommended — set once, auto-deactivates on completion)
const session = await loft.chat.createSession({
  currentLlmName: 'claude-sonnet-5-5',
  currentManifestName: 'default',
  externalKey: {},
  focusAgent: 'intake'  // Focus activates automatically on every generate() call
});

// No focusAgent needed per-call — reads from session
const result = await loft.chat.generate({ sessionId: session.id, directMessages });

// result.focusStatus contains collection progress
console.log(result.focusStatus);
// { agentName: 'intake', filled: { product: 'Widget' }, missing: ['quantity', 'priority'], ready: false }
```

**Resolution priority:** `options.focusAgent` (per-call) > `options.focusAgent === null` (disable) > `session.focusAgent` (session-level) > no Focus.

**Auto-deactivation:** When all required fields are collected (`focusStatus.ready === true`), the session's `focusAgent` is automatically cleared. Subsequent calls skip Focus with zero overhead. A different Focus passed per call does not end the session's Focus.

**Completion clears the values:** the completing call returns the collected values once, in `focusStatus.filled`, and then clears them from the focus state store. The next call that uses the same Focus starts empty, and the collected personal data does not stay in the store.

**Values stay data:** the Focus prompt shows the collected values as escaped JSON inside a `<collected_values>` block, with string values capped at 500 characters, so a value cannot add instructions to the prompt.

### Focus with LoftAgentNode

By default the agent uses the session's Focus: set `focusAgent` on the session at creation time. To make a node always collect one Focus, pass its registered name as `focusName`. The `onFocusComplete` action on the agent controls graph routing when Focus completes.

```typescript
import { LoftAgentNode } from '@moc-global/loft-agents';

const intake = new LoftAgentNode({
  name: 'intake',
  loft,
  llmName: 'claude-sonnet-5-5',
  manifestName: 'intake-manifest',
  transitions: [{ name: 'collecting', description: 'Still collecting', target: null }],
  // focusAgent comes from session — set at session creation time
  onFocusComplete: { type: Agent.FocusActionType.TRANSITION, target: 'processor' }
});

// Or: this node always collects the Focus registered as 'intake'
const pinnedIntake = new LoftAgentNode({
  name: 'intake-node',
  loft,
  llmName: 'claude-sonnet-5-5',
  manifestName: 'intake-manifest',
  transitions: [{ name: 'collecting', description: 'Still collecting', target: null }],
  focusName: 'intake',
  onFocusComplete: { type: Agent.FocusActionType.TRANSITION, target: 'processor' }
});
```

**How it works:**
1. Session is created with `focusAgent: 'intake'`
2. User sends a message → `generate()` reads `focusAgent` from session, injects Focus prompt and tools
3. LLM extracts field values using auto-generated tools (update, confirm, classify)
4. Tools validate and store values in the focus state store
5. LLM asks for missing fields naturally
6. When all required fields are filled → Focus auto-deactivates on session, `onFocusComplete` transition fires
7. Collected data is written to `SharedContext` as `focus:intake` for downstream agents

**Field types:** `STRING`, `NUMBER`, `BOOLEAN`, `ENUM` (with `values`), `DATE` (ISO 8601)

### Standalone Focus (low-level API)

The underlying Focus functions are also exported from `@moc-global/loft` for advanced use cases:

```typescript
import { computeFocusStatus, generateFocusPrompt, generateFocusTools, InMemoryFocusStateStore } from '@moc-global/loft';

const store = new InMemoryFocusStateStore();
const stored = await store.getAll(sessionId, focusConfig.agentName);
const status = computeFocusStatus(focusConfig, stored);
const prompt = generateFocusPrompt(focusConfig, status);
const tools = generateFocusTools(focusConfig, store, sessionId);
```

## 5. FAN_OUT — Parallel Execution

Run multiple agents simultaneously using a custom transition resolver:

```typescript
const dispatcher = new LoftAgentNode({
  name: 'dispatcher',
  loft,
  llmName: 'claude-sonnet-5-5',
  manifestName: 'dispatcher-manifest',
  transitions: [
    { name: 'to-a', description: 'Agent A', target: 'agent-a' },
    { name: 'to-b', description: 'Agent B', target: 'agent-b' },
    { name: 'to-c', description: 'Agent C', target: 'agent-c' }
  ],
  transitionResolver: () => ({
    type: Agent.TransitionType.FAN_OUT,
    targets: ['agent-a', 'agent-b', 'agent-c']
  })
});
```

All three agents run in parallel via `Promise.allSettled()`. The orchestrator waits for all to complete, then converges based on their transitions. The next node's input message is the answer of the last target in the list (`agent-c` here). Every `LoftAgentNode` also stores its answer in the `SharedContext` under its name, so the next node receives all three answers with the shared context. Set `shareOutput: false` on a node to keep its answer out.

### Error Handling in FAN_OUT

```typescript
const orchestrator = new OrchestratorBuilder()
  .addNode(dispatcher)
  .addNode(agentA)
  .addNode(agentB)
  .addNode(agentC)
  .setEntry('dispatcher')
  .setErrorStrategy(Agent.ErrorStrategy.CONTINUE)  // don't fail if one agent errors
  .build();
```

- `FAIL_FAST` (default) — any failure throws `FanOutPartialError`
- `CONTINUE` — proceed with successful results, store failures in `SharedContext` under `__fanout.rejected`

## 6. Teams — Encapsulated Sub-Graphs

Group agents into a team that acts as a single node in the parent graph:

```typescript
import { TeamBuilder } from '@moc-global/loft-agents';

const reviewTeam = new TeamBuilder('review-team')
  .systemPrompt('You are a content review team.')
  .addNode(factChecker)
  .addNode(editor)
  .setEntry('fact-checker')
  .setMaxDepth(5)
  .addTransition({ name: 'done', description: 'Review complete', target: 'publisher' })
  .build();

// Use it like any other node
const orchestrator = new OrchestratorBuilder()
  .addNode(writer)
  .addNode(reviewTeam)
  .addNode(publisher)
  .setEntry('writer')
  .build();
```

A team runs on its own `SharedContext`. It starts with a copy of the parent's entries, and the keys it adds, including its nodes' answers, are copied back to the parent as `team:<team name>:<key>`; its changes to existing keys stay inside the team.

## 7. Production Hardening

### Retry + Timeout (per node)

```typescript
const orchestrator = new OrchestratorBuilder()
  .addNode(searchAgent, {
    retry: { maxRetries: 2, delayMs: 1000, backoffMultiplier: 2 },
    timeout: { timeoutMs: 30000 }
  })
  .addNode(formatter)  // no policy needed for simple nodes
  .setEntry('searchAgent')
  .build();
```

A timeout cancels the node's in-flight LLM call before any retry starts: `LoftAgentNode` passes the node's `AbortSignal` to `generate()`, which passes it to the provider SDK. A custom node receives the signal as `options.signal` in `run()` and should pass it on. To cancel a whole run, pass a signal to `run()`:

```typescript
const controller = new AbortController();
const result = orchestrator.run(message, sessionId, undefined, { signal: controller.signal });
controller.abort(); // in-flight nodes are aborted and no further node starts
```

The provider may still bill for tokens it generated before the cancellation.

### Tracing + Metrics

```typescript
const orchestrator = new OrchestratorBuilder()
  .addNode(...)
  .setTracer(myTracer)  // implements Strategy.Tracer.Tracer
  .setMetricsCallback((metrics) => {
    console.log(`Duration: ${metrics.orchestratorDurationMs}ms`);
    console.log(`Path: ${metrics.transitionPath.join(' → ')}`);
    for (const node of metrics.nodeMetrics) {
      console.log(`  ${node.nodeName}: ${node.durationMs}ms`);
    }
  })
  .setCycleDetection(true)
  .build();
```

## Full Example

See [examples/express-agents/](../../examples/express-agents/) — the Restaurant Agent Showcase. An LLM router reads each message and hands it to one of five pipelines, with a single sommelier agent as the fallback:

```
[router] ── LLM classifies intent ── TransitionResolver picks target
    │
    ├── wine/food question   → [sommelier]
    ├── plan a dinner        → [nutritionist] → [chef] → [presenter]
    ├── organize catering    → [dispatcher] → FAN_OUT → [3 specialists] → [coordinator]
    ├── review a restaurant  → [visit] → [review-team] → [verdict]
    ├── plan a banquet       → [intake/Focus] → FAN_OUT → [planning-team] → [proposal]
    └── book a table         → [intake/Focus+resolveFields] → [availability-check] → [confirmation]
```

Run the demo from the repository root:

```bash
docker compose -f examples/docker-compose.yml up -d    # PostgreSQL
pnpm install
turbo build --filter=@moc-global/example-express-agents...
cd examples/express-agents
cp .env.example .env    # set ANTHROPIC_API_KEY
pnpm migrate
pnpm dev                # start the server (port 3005)
bash test-chat.sh       # in another terminal: run the demo
```

## SharedContext

Agents share data through `SharedContext` — a key-value store passed to every node:

```typescript
// Inside a custom node's run() method:
sharedContext.set('search-results', { flights: [...] });

// Another node reads it (deep copy — safe from mutation):
const results = sharedContext.get('search-results');
```

SharedContext is automatically serialized as a JSON system message for each LLM call, so agents can "read" data from other agents.

**Reserved keys:**
- `focus:<agentName>` — auto-written when Focus completes
- `__fanout.rejected` — auto-written when ErrorStrategy.CONTINUE handles failures
- `__team.systemPrompt` — internal team prompt

## Next Steps

- [Agent Orchestration Concepts](../concepts/agents/README.md) — design docs and flow diagrams
- [ADRs](../adr/loft-agents/README.md) — architecture decisions behind Focus, Teams, SharedContext, etc.
- [express-focus-basic example](../../examples/express-focus-basic/README.md) — Focus with plain `chat.generate()` and no orchestrator: a pizza order bot
- [express-agents example](../../examples/express-agents/README.md) — runnable restaurant agent showcase with every feature
