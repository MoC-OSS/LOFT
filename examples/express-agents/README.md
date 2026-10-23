# Restaurant Agent Showcase

Build multi-agent systems with typed graphs, parallel execution, structured data collection, and team coordination — all on top of real LLM calls.

> **Not for production.** This example has no authentication or authorization and uses demo settings. Use it to learn LOFT, not as a template for a deployed service: add authentication, access checks on sessions, rate limiting and your own error handling first.

This Express app demonstrates **5 progressively complex pipelines** behind an **LLM-powered router** — all powered by `@moc-global/loft-agents`. The user sends a free-form message, the router classifies intent, and the right pipeline executes automatically.

```
User: "Book a table for Saturday"
    │
    ▼
[router] ── LLM classifies intent ── TransitionResolver picks target
    │
    ├── wine/food question   → [sommelier] ← answers directly
    ├── plan a dinner        → [nutritionist] → [chef] → [presenter]
    ├── organize catering    → [dispatcher] → FAN_OUT → [3 specialists] → [coordinator]
    ├── review a restaurant  → [visit] → [review-team] → [verdict]
    ├── plan a banquet       → [intake/Focus] → FAN_OUT → [planning-team] → [proposal]
    └── book a table         → [intake/Focus+resolveFields] → [availability-check] → [confirmation]
```

## The Router — Intelligent Dispatch

> **Problem:** Users arrive with unpredictable intents. Hard-coding `if/else` for every intent is brittle — adding a new capability means changing routing logic. You need the LLM itself to classify intent and dispatch to the right specialist.

The router is a `LoftAgentNode` with a custom `TransitionResolver`. The LLM classifies intent and includes a `[ROUTE:target]` tag in its response. The resolver parses it and returns a typed transition:

```typescript
const routerTransitionResolver: Agent.TransitionResolver = (result, transitions) => {
  const text = result.messages.llmResponse.topChoice.content
    .filter((c) => c.type === 'text').map((c) => c.text).join('');

  const match = text.match(/\[ROUTE:(\S+)\]/);
  const target = match?.[1];
  const valid = transitions.find((t) => t.target === target);

  return valid
    ? { type: Agent.TransitionType.SINGLE, target: valid.target! }
    : { type: Agent.TransitionType.SINGLE, target: 'sommelier' }; // fallback
};

const router = new LoftAgentNode({
  name: 'router',
  loft,
  llmName: MODEL_NAME,
  manifestName: 'router',             // system prompt instructs LLM to classify + tag
  transitions: FLOW_TARGETS.map((t) => ({ name: `to-${t}`, description: `Route to ${t}`, target: t })),
  transitionResolver: routerTransitionResolver
});
```

Adding a new flow is just adding a target to the array and updating the router's system prompt — zero code changes to routing logic. The `TransitionResolver` is fully pluggable: LLM-driven, rule-based, or a mix.

**Try it:** send any message — the router decides which pipeline handles it.

## The 5 Pipelines

Each pipeline solves a progressively harder orchestration problem. The router dispatches to the right one automatically.

---

### Pipeline 1: Agent Chain

> **Problem:** A single agent can't handle complex tasks well. You need to break work into specialized steps where each agent builds on the previous one's output — like an assembly line.

```
[nutritionist] → [chef] → [presenter] ← TERMINAL
```

The nutritionist analyzes dietary needs, the chef creates recipes using that analysis, and the presenter formats everything into a menu card. Each agent reads the previous agent's output through `SharedContext`.

```typescript
const nutritionist = new LoftAgentNode({
  name: 'nutritionist',
  loft, llmName, manifestName: 'nutritionist',
  transitions: [{ name: 'to-chef', description: 'Pass analysis to chef', target: 'chef' }]
});
// chef → presenter → TERMINAL
```

**Try it:** `"Plan a romantic 3-course Italian dinner for two"`

---

### Pipeline 2: Parallel Execution

> **Problem:** You have multiple independent tasks. Running them sequentially wastes time — 3 agents × 10 seconds = 30 seconds. And if one agent fails, you lose everything, even though the other two succeeded.

```
[dispatcher] → FAN_OUT → [appetizers] [mains] [desserts] → [coordinator] ← TERMINAL
```

Three menu specialists run **simultaneously**. Total time = the slowest agent, not the sum. If one fails, `ErrorStrategy.CONTINUE` delivers partial results instead of crashing the whole pipeline. The coordinator reads `FANOUT_REJECTED_KEY` to explain what's missing and why.

```typescript
const fanOutResolver: Agent.TransitionResolver = () => ({
  type: Agent.TransitionType.FAN_OUT,
  targets: ['appetizers-specialist', 'mains-specialist', 'desserts-specialist']
});
```

Per-node resilience policies — retry with backoff, timeout with AbortSignal:

```typescript
new OrchestratorBuilder()
  .addNode(dispatcher)
  .addNode(appetizers, { retry: { maxRetries: 2, delayMs: 1000, backoffMultiplier: 2 } })
  .addNode(mains)
  .addNode(desserts, { timeout: { timeoutMs: 30000 } })
  .addNode(coordinator)
  .setEntry('catering-dispatcher')
  .setErrorStrategy(Agent.ErrorStrategy.CONTINUE)
  .build();
```

**Try it:** `"Organize catering for 50 people, Mediterranean theme"`

---

### Pipeline 3: Agent Team

> **Problem:** A group of agents needs to collaborate on a subtask — but their internal state shouldn't leak into the parent pipeline, and you want to reuse this group as a single unit in different contexts.

```
[visit] → [review-team] → [verdict] ← TERMINAL
              ├── [food-critic]
              └── [ambiance-critic]
```

`TeamBuilder` creates an **isolated sub-graph**. The parent context is copied in as a read-only snapshot. Critics work inside the team's own namespace. When the team finishes, only the final results propagate back — scoped under `team:review-team:` — keeping the parent context clean.

```typescript
const reviewTeam = new TeamBuilder('review-team')
  .systemPrompt('You are a restaurant review team.')
  .addNode(foodCritic)
  .addNode(ambianceCritic)
  .setEntry('food-critic')
  .setMaxDepth(5)
  .addTransition({ name: 'to-verdict', description: 'Final verdict', target: 'verdict-writer' })
  .build();
```

**Try it:** `"Write a detailed review of a fine dining French restaurant called Le Petit Bistro"`

---

### Pipeline 4: Full Pipeline

> **Problem:** A real-world task that requires everything — collecting structured input from the user across multiple conversation turns, parallel research, team-based planning, and a final synthesized output. No single pattern is enough.

```
[intake/Focus] → [dispatcher] → FAN_OUT → [venue] [menu] [entertainment]
                                               → [planning-team] → [proposal] ← TERMINAL
                                                   ├── [planner]
                                                   └── [budget-optimizer]
```

The user says "I need to organize a banquet" — but you need 6 pieces of information before you can do anything. **Focus** collects them across multiple conversation turns with typed fields, validation, and defaults. Once complete, the pipeline fans out to three search agents, passes through a planning team, and produces a final proposal.

```typescript
const banquetFocus: Agent.Focus = {
  agentName: 'banquet-intake',
  prompt: 'Collect banquet event details through natural conversation',
  fields: [
    { key: 'event_date', type: Agent.FocusFieldType.DATE, required: true },
    { key: 'guest_count', type: Agent.FocusFieldType.NUMBER, required: true,
      validate: (v) => Number(v) >= 1 && Number(v) <= 500 ? true : 'Must be 1-500' },
    { key: 'budget', type: Agent.FocusFieldType.NUMBER, required: true },
    { key: 'cuisine_preference', type: Agent.FocusFieldType.ENUM, required: true,
      values: ['italian', 'french', 'asian', 'mixed'] },
    { key: 'venue_preference', type: Agent.FocusFieldType.ENUM, required: true,
      values: ['indoor', 'outdoor', 'both'] },
    { key: 'needs_accessibility', type: Agent.FocusFieldType.BOOLEAN, default: false },
  ],
  onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'banquet-dispatcher' }
};
```

**Try it:** `"I need to organize a banquet for my company anniversary"` (multi-turn)

---

### Pipeline 5: Dynamic Forms + Custom Logic

> **Problem:** Your data collection form isn't static — some fields only make sense depending on earlier answers. And part of your pipeline is pure business logic (database lookup, availability check) that doesn't need an LLM at all.

```
[intake/Focus+resolveFields] → [availability-check] → [confirmation] ← TERMINAL
                                    (custom Node, no LLM)
```

Two things this flow solves that others don't:

**Dynamic fields** — the form changes shape based on user input. When `special_occasion` is `true`, an `occasion_type` field appears at runtime. Focus builds its tools once per turn, so the new field can be filled from the next turn on; the demo script asks for it in a fourth turn. The intake agents also get today's date from a GM computer (`src/shared/setup.ts`), so the model can turn "this Saturday" into a date:

```typescript
resolveFields: ({ fields, filled }) => {
  if (filled.special_occasion === true) {
    return [...fields, {
      key: 'occasion_type',
      type: Agent.FocusFieldType.ENUM,
      values: ['birthday', 'anniversary', 'business', 'other'],
      required: true
    }];
  }
  return fields;
}
```

**Non-LLM nodes** — not every step needs an LLM. `AvailabilityCheckNode` implements `Agent.Node` directly for pure computation (database lookups, API calls, business rules):

```typescript
class AvailabilityCheckNode implements Agent.Node {
  readonly name = 'availability-check';
  readonly transitions = [{ name: 'confirm', description: 'Confirm', target: 'reservation-confirmation' }];

  async run(message, sharedContext, sessionId): Promise<Agent.NodeResult> {
    const focusData = sharedContext.get<Record<string, unknown>>('focus:reservation-intake');
    const scoped = sharedContext.for('availability-check'); // namespaced writes

    // Simulated: a large party wanting outdoor seating at the weekend gets no table
    const partySize = Number(focusData?.party_size ?? 0);
    const outdoor = focusData?.outdoor_seating === true;
    const available = !(this.isWeekendDate(String(focusData?.date ?? '')) && partySize > 8 && outdoor);
    scoped.set('available', available);

    return {
      output: { role: Agent.AgentMessageRole.ASSISTANT, content: `Table ${available ? 'confirmed' : 'unavailable'}` },
      transition: { type: Agent.TransitionType.SINGLE, target: 'reservation-confirmation' }
    };
  }
}
```

**Try it:** `"I'd like to book a table"` (multi-turn, try mentioning a birthday)

## Example Output

### Focus status during collection (reservation flow)

```json
// Turn 1: "I'd like to book a table"
{
  "response": "I'd love to help! What date and time works for you, and how many guests?",
  "focusStatus": {
    "agentName": "reservation-intake",
    "filled": { "outdoor_seating": false, "special_occasion": false },
    "missing": ["date", "time", "party_size"],
    "ready": false
  }
}

// Turn 2: "June 7th at 7pm for 4 people, it's a birthday"
{
  "response": "Got it! I still need: occasion_type. Could you provide that?",
  "focusStatus": {
    "filled": { "date": "2025-06-07", "time": "19:00", "party_size": 4,
                "outdoor_seating": false, "special_occasion": true },
    "missing": ["occasion_type"],
    "ready": false
  }
}

// Turn 3: "birthday"
{
  "response": "Your table for 4 on June 7th at 7pm is confirmed! Happy birthday!",
  "focusStatus": { "filled": { "...all fields..." }, "missing": [], "ready": true }
}
```

### Orchestrator metrics (console output)

```
========== ORCHESTRATOR METRICS ==========
Total Duration: 9659ms
Depth Reached:  4
Transition Path: router → reservation-intake → availability-check → reservation-confirmation
  router: 2420ms
  reservation-intake: 4441ms
  availability-check: 0ms
  reservation-confirmation: 2796ms
==========================================
```

## Feature Coverage

### Core

| Feature | Where | What it solves |
|---------|-------|---------------|
| `LoftAgentNode` | All | Wrap any LLM behind a typed node with system prompt, model, and transitions |
| `TERMINAL` transition | All | Mark a node as the final step — no further routing |
| `SINGLE` transition | 1, 3, 4, 5 | Hand off to exactly one next agent |
| Custom `TransitionResolver` | Router, 2, 4 | Let the LLM (or your code) decide where to go next at runtime |
| `SharedContext` | 1-5 | Pass data between agents without coupling them directly |
| Custom `Agent.Node` (non-LLM) | 5 | Run business logic, DB lookups, or API calls as a pipeline step — no LLM needed |

### Parallel Execution & Resilience

| Feature | Where | What it solves |
|---------|-------|---------------|
| `FAN_OUT` | 2, 4 | Run independent agents simultaneously instead of sequentially |
| `ErrorStrategy.CONTINUE` | 2, 4 | Deliver partial results when some agents fail instead of losing everything |
| `FANOUT_REJECTED_KEY` | 2 | Tell downstream agents which parallel branches failed and why |
| Retry policy | 2, 4 | Recover from transient LLM failures with exponential backoff |
| Timeout policy | 2, 4 | Kill slow agents after a deadline (AbortSignal-based) |

### Teams

| Feature | Where | What it solves |
|---------|-------|---------------|
| `TeamBuilder` / `TeamNode` | 3, 4 | Package a group of agents as one reusable unit |
| Context isolation | 3, 4 | Prevent team internals from polluting the parent pipeline's state |

### Focus (Structured Data Collection)

| Feature | Where | What it solves |
|---------|-------|---------------|
| Multi-turn collection | 4, 5 | Gather structured data across conversation turns without manual state tracking |
| Field types | 4, 5 | Type-safe fields: `STRING`, `NUMBER`, `ENUM`, `DATE`, `BOOLEAN` |
| `default` values | 4, 5 | Skip optional fields — pre-fill with sensible defaults |
| Custom validation | 4, 5 | Reject invalid input immediately (e.g. "party size must be 1-20") |
| `resolveFields` | 5 | Add/remove fields at runtime based on what was already collected |
| `onFocusComplete` transition | 4, 5 | Auto-trigger the next pipeline step when all data is collected |

### Observability

| Feature | Flows | What it solves |
|---------|-------|---------------|
| Tracing (`ConsoleTracer`) | All | See execution spans — which agent ran, when, and how long |
| Metrics callback | All | Measure duration, path, and token usage per node |
| Cycle detection | All | Prevent infinite loops — repeated node patterns are detected, and a run stops at the max depth (the library default is 10, or `LOFT_AGENTS_MAX_DEPTH`; this example sets 15 with `setMaxDepth(15)`) |
| Middleware | All | Hook into input, pre-LLM, and post-LLM stages for logging or transforms |

## Quick Start

Needs Node.js 22.12 or later.

```bash
# From the repository root:

# 1. Start PostgreSQL
docker compose -f examples/docker-compose.yml up -d

# 2. Install dependencies
pnpm install

# 3. Build the example and all its LOFT dependencies
pnpm turbo build --filter=@moc-global/example-express-agents...

# 4. Configure
cd examples/express-agents
cp .env.example .env
# Set ANTHROPIC_API_KEY in .env

# 5. Run migrations & start
pnpm migrate
pnpm dev

# 6. Open the UI
open http://localhost:3005
```

The web UI lets you pick a flow, send messages, and see Focus status + debug info in real time.

### Test all flows from the command line

```bash
./test-chat.sh
```

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/flows` | List available flows |
| `POST` | `/api/sessions` | Create session |
| `POST` | `/api/chat` | Send message `{ sessionId, message }` |
| `GET` | `/api/sessions/:id/history` | Conversation history |

## Project Structure

```
examples/express-agents/
├── manifest/manifest.json           # System prompts for all 24 agents
├── public/index.html                # Web UI for interactive testing
├── src/
│   ├── index.ts                     # Express app entry
│   ├── routes.ts                    # API routes + multi-turn Focus handling
│   ├── config.ts                    # Zod env validation
│   ├── database.ts                  # PostgreSQL connection
│   ├── migrate.ts                   # Database migrations
│   ├── shared/
│   │   ├── setup.ts                 # LOFT initialization
│   │   ├── middleware.ts            # Logging middleware
│   │   └── tracer.ts               # ConsoleTracer
│   ├── router/
│   │   ├── agent.ts                 # Router + TransitionResolver
│   │   └── orchestrator.ts          # Wires all 6 flows into one graph
│   └── flows/
│       ├── simple/agents.ts         # Sommelier — router fallback target
│       ├── chain/agents.ts          # Pipeline 1: nutritionist → chef → presenter
│       ├── parallel/agents.ts       # Pipeline 2: dispatcher + specialists + coordinator
│       ├── team/agents.ts           # Pipeline 3: visit + review-team + verdict
│       ├── full/agents.ts           # Pipeline 4: Focus + FAN_OUT + Team
│       └── reservation/agents.ts    # Pipeline 5: resolveFields + custom Node
├── test-chat.sh                     # CLI demo script
└── package.json
```

## Adding Your Own Flow

1. Create `src/flows/myflow/agents.ts` — define your agent nodes
2. Add system prompts to `manifest/manifest.json`
3. Add your nodes to the orchestrator in `src/router/orchestrator.ts`
4. Add a transition target in `src/router/agent.ts` (`FLOW_TARGETS` array)
5. Update the router's system prompt in `manifest.json` to recognize the new intent
