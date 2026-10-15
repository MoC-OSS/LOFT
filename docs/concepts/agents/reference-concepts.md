# Betonbrut Agent Interaction Concepts

Reference document for re-implementing betonbrut's agent interaction model in another library.

---

## 1. Node — The Universal Building Block

Everything in betonbrut is a **Node**. Agents, classifiers, teams — all implement the same interface:

```
Node
  Name() string
  Run(ctx, message, sharedContext) → (Result, error)
  Transitions() []TransitionDef
```

Optional streaming extension:

```
StreamableNode extends Node
  Stream(ctx, message, sharedContext) → chan StreamEvent
```

A **Result** contains:

- `Output` — the message produced by the node
- `Transition` — routing decision (where to go next)

### Key insight

There is no special "Agent" type. An LLM-backed agent, a deterministic classifier, and a multi-agent team are all Nodes. This makes the system fully composable — any Node can be used anywhere another Node is expected.

---

## 2. Transitions — Routing Between Nodes

Each node declares its **available transitions** statically (at build time):

```
TransitionDef
  Name        — identifier (e.g., "billing", "technical", "done")
  Description — LLM-readable explanation of when to take this transition
  Target      — destination node name
```

At runtime, a node returns a **Transition** selecting which declared path(s) to follow:

| Type                 | Behavior                                   |
| -------------------- | ------------------------------------------ |
| `TransitionSingle`   | Route to exactly one target node           |
| `TransitionFanOut`   | Route to multiple targets in parallel      |
| `TransitionTerminal` | Execution complete, no further transitions |

The orchestrator resolves transition targets by name and dispatches accordingly.

---

## 3. SharedContext — Agent Communication

Agents communicate through a **SharedContext** — a thread-safe key-value store plus conversation history:

```
SharedContext
  History() []Message        — ordered conversation messages (returns copy)
  AppendMessage(msg)         — add message to history
  Get(key) → (value, bool)  — retrieve structured data
  Set(key, value)            — store structured data
  Keys() []string            — list all keys (returns copy)
  Delete(key)                — remove a key
```

### Properties

- All methods are **concurrent-safe** (protected by RWMutex)
- `History()` and `Keys()` return **defensive copies**
- Scoped per orchestrator / per team (teams get isolated contexts)
- Enables agent-to-agent data exchange within teams

### Two communication patterns

1. **Structured state** — `Get`/`Set` for typed key-value data exchange between agents
2. **Conversation history** — `AppendMessage` for building shared conversation context

---

## 4. Messages — The Data Unit

```
Message
  Role       — user | assistant | system | tool
  Content    — text content
  ToolCalls  — tool invocation requests (assistant role only)
  ToolCallID — references original ToolCall (tool role only)
  Data       — map[string]any for node-to-node structured data
```

Messages serve dual purpose:

- **LLM conversation history** entries (role + content + tool calls)
- **Node-to-node data transfer** along transitions (via the Data field)

---

## 5. Orchestrator — Graph Execution Engine

The orchestrator manages a directed graph of nodes:

```
Orchestrator
  Run(ctx, message) → (Message, error)
  Stream(ctx, message) → chan StreamEvent

OrchestratorBuilder
  AddNode(node)
  SetEntry(name)              — which node receives input first
  WithSharedContextFactory(fn) — custom context creation
  Build() → (Orchestrator, error)
```

### Execution loop

```
1. Receive input message
2. Create SharedContext
3. Run entry node with message + context
4. Read Result.Transition
   - TransitionSingle → run target node with Result.Output
   - TransitionFanOut → run all targets in parallel (SharedContext is thread-safe)
   - TransitionTerminal → return Result.Output as final answer
5. Repeat from step 4 until terminal
```

### Build-time validation

The builder validates the graph before returning:

- Entry node must exist
- All transition targets must reference existing nodes
- Catches configuration errors before runtime

---

## 6. Team — Encapsulated Multi-Agent Unit

A Team is a Node that contains an Orchestrator + child Nodes internally:

```
Team
  name         — identifier
  systemPrompt — team-level mission/context
  agents       — child nodes
  orchestrator — internal coordination engine
  transitions  — outgoing transitions (when team is used as a node)
```

### Key behaviors

- **Team implements Node** — fully composable, can be nested inside other orchestrators or teams
- **Isolated context** — team creates a new SharedContext; parent state is never modified
- **Team system prompt** injected as first system message in the internal context
- **Internal interactions are invisible** to the caller — team produces a single Result
- **Encapsulation boundary** — the team is a black box from the outside

### Building a team

```
NewTeamBuilder("name")
  .SystemPrompt("Team mission...")
  .AddAgent(node1)
  .AddAgent(node2)
  .Orchestrator(orch)
  .AddTransition(TransitionDef{...})
  .Build()
```

---

## 7. Tool — Agent Capabilities

```
Tool
  Name() string
  Description() string
  Schema() ToolSchema          — JSON Schema for input parameters
  Execute(ctx, input) → (any, error)

ToolSchema
  Parameters — json.RawMessage (JSON Schema definition)

ToolCall
  ID        — unique invocation identifier
  Name      — tool name to invoke
  Arguments — tool input as JSON
```

Tools are passed to the Model via `GenerateRequest.Tools`. The model decides which tools to call; the framework executes them and feeds results back.

---

## 8. Focus — Goal-Oriented State Collection

Focus enables agents to systematically collect structured information from users with validation.

### Definition

```
Focus
  agentName  — owning agent
  prompt     — natural language purpose (injected into system prompt)
  fields     — list of FocusField definitions
  onComplete — action to take when all required fields are filled
```

### FocusField

```
FocusField
  Key         — SharedContext key suffix (stored as "{agentName}.focus.{key}")
  Type        — String | Number | Bool | Enum | Date
  Required    — must be filled before completion?
  Default     — value for optional fields when not set
  Description — LLM-readable explanation
  Validate    — optional custom validation function
```

### FocusAction (on completion)

```
FocusAction
  Type     — Tool | Transition
  ToolName — tool to call when ready (for Tool type)
  Target   — transition target when ready (for Transition type)
```

### Focus Tools (auto-generated)

Each Focus generates three tools:

| Tool                  | Purpose                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **UpdateFocusTool**   | Validates and stores field values in SharedContext. Performs type coercion and custom validation. Writes field metadata on first use. |
| **ConfirmFocusTool**  | Presents summary of all collected fields. Reports filled/missing fields. Blocks confirmation if required fields are missing.          |
| **ClassifyFocusTool** | Classifies user input relevance: `on_focus`, `off_focus`, or `unknown`. Used by orchestrator to detect topic switches.                |

### FocusStatus — Current Fill State

```
FocusStatus
  Agent   — owning agent name
  Filled  — map of collected field values
  Missing — list of required fields still needed
  HasData — any focus data exists?
  Ready   — all required fields filled?
```

### Focus Key Methods

| Method           | Purpose                                                       |
| ---------------- | ------------------------------------------------------------- |
| `Prompt()`       | Generates system prompt fragment including field descriptions |
| `Status(ctx)`    | Reads current fill state from SharedContext                   |
| `Clear(ctx)`     | Wipes all focus data for the agent                            |
| `WriteMeta(ctx)` | Stores field schema in SharedContext for introspection        |

### FocusAware Interface

```
FocusAware
  Focus() → *Focus
```

Nodes that implement `FocusAware` signal to the orchestrator that they have pending state collection. The orchestrator can:

- Detect when a user switches topics while focus fields are partially filled
- Present the user with an option to continue or discard pending work
- Prevent information loss during topic switches

---

## 9. Model — LLM Provider Interface

```
Model
  Generate(ctx, request) → (response, error)
  Stream(ctx, request) → chan StreamEvent

GenerateRequest
  Messages — conversation history
  Tools    — available tools

GenerateResponse
  Message — assistant's response (may contain ToolCalls)
```

The Model interface is what adapters implement (OpenAI, Anthropic, Ollama, etc.).

---

## 10. Streaming

```
StreamEventType
  Token      — text token produced
  ToolCall   — tool invocation initiated
  ToolResult — tool execution result
  Error      — error during streaming
  Done       — stream complete

StreamEvent
  Type       — event kind
  Token      — text content (Token events)
  ToolCall   — tool call details (ToolCall events)
  ToolResult — tool result data (ToolResult events)
  Error      — error value (Error events)
  Message    — final complete message (Done events)
```

- Streaming is **opt-in** via the `StreamableNode` interface
- Orchestrator detects streaming capability via type assertion
- Channels are closed when execution completes

---

## 11. Functional Options

Configuration follows the functional options pattern:

```
RunOption = func(*runConfig)
```

Used for optional configuration of `Run()` and `Stream()` calls. Examples include structured output type specification, timeout overrides, etc.

Builder patterns are used for constructing Orchestrators and Teams.

---

## 12. Error Handling

Go-idiomatic: all operations return `error` as the last value.

Core errors:

- `ErrNodeNotFound` — referenced node doesn't exist
- `ErrNoEntryNode` — no entry node configured
- `ErrInvalidGraph` — invalid graph configuration
- `ErrTransitionFail` — transition target not found

No automatic retries. No magic recovery. Callers compose their own retry/circuit-breaker logic.

---

## 13. Design Patterns Summary

| Pattern                          | Application                                                                |
| -------------------------------- | -------------------------------------------------------------------------- |
| **Composition over inheritance** | All units are Nodes; teams contain nodes; no subclassing                   |
| **Functional options**           | `WithX()` functions for optional configuration                             |
| **Interface segregation**        | Small interfaces (1-3 methods); optional via type assertion                |
| **Builder pattern**              | Graph construction with build-time validation                              |
| **Defensive copying**            | History/Keys return copies; SharedContext never leaks references           |
| **Context propagation**          | `context.Context` as first param everywhere                                |
| **Progressive complexity**       | Start with just Node + Orchestrator; add Focus, Teams, streaming as needed |

---

## 14. Complete Execution Flow

```
User Input
  │
  ▼
Orchestrator.Run(ctx, message)
  │
  ├─ Create SharedContext
  │
  ▼
Entry Node.Run(ctx, msg, sharedContext)
  │
  ├─ Read from SharedContext (history, structured data)
  ├─ Model.Generate() with tools (if LLM-backed)
  ├─ Tool.Execute() for each tool call (if any)
  ├─ Append results to SharedContext.History
  │
  ▼
Return Result{Output, Transition}
  │
  ├─ TransitionSingle → next node receives Output as input
  ├─ TransitionFanOut → parallel execution, SharedContext shared
  └─ TransitionTerminal → return Output as final answer
```

### Team execution (when a node is a Team)

```
Parent Orchestrator dispatches to Team node
  │
  ▼
Team.Run()
  ├─ Create NEW isolated SharedContext
  ├─ Inject team system prompt
  ├─ Run internal orchestrator
  ├─ Internal agent interactions (invisible to parent)
  │
  ▼
Return single Result to parent orchestrator
  (parent SharedContext unchanged)
```

---

## 15. Glossary

| Term           | Definition                                                                   |
| -------------- | ---------------------------------------------------------------------------- |
| Node           | Universal execution unit — implements Name, Run, Transitions                 |
| StreamableNode | Node with streaming capability (extends Node with Stream)                    |
| Orchestrator   | Graph execution engine — manages nodes and resolves transitions              |
| Team           | Encapsulated multi-node unit with isolated context (is itself a Node)        |
| SharedContext  | Thread-safe key-value store + conversation history for agent communication   |
| Transition     | Routing decision: single target, fan-out (parallel), or terminal             |
| TransitionDef  | Static declaration of an available transition (name, description, target)    |
| Result         | Node output: message + transition decision                                   |
| Tool           | Capability exposed to LLM-backed nodes via Tool interface                    |
| Focus          | Structured state collection framework with validation and completion actions |
| FocusAware     | Interface for nodes that have active Focus state collection                  |
| Model          | LLM provider abstraction (Generate + Stream)                                 |
| StreamEvent    | Single event in a streaming response                                         |
| Message        | Communication unit with role, content, tool calls, and structured data       |
