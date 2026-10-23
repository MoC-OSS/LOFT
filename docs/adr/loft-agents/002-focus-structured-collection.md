# ADR-002: Focus — Tool-Driven Structured Data Collection

## Status

Accepted

> **Moved:** the Focus code now lives in `packages/loft/src/focus/` (`ToolGenerator.ts`, `StatusComputer.ts`, `TypeCoercion.ts`, `PromptGenerator.ts`, `InMemoryStateStore.ts`, `UpdateTool.ts`, `ConfirmTool.ts`, `ClassifyTool.ts`), and `@moc-global/loft-agents` re-exports it. The paths in this record are as they were when it was written.

## Context

Agents often need structured input before they can act — a travel planner needs destination, dates, budget, and group size. Users provide this conversationally across multiple turns, not as a single form submission. The system needs to:

- Track what's been collected and what's still missing
- Validate and coerce field values (dates as ISO 8601, numbers from strings)
- Let the LLM drive the conversation naturally while enforcing data completeness
- Auto-transition to the next stage when all required fields are filled

## Decision

Declarative field definitions combined with an LLM-driven tool loop. Focus generates three tools dynamically, injects a status prompt before each LLM call, and auto-transitions when all required fields are filled.

### Focus Definition

```typescript
// packages/loft-definitions/src/shared/components/Agent.ts:136-141
export interface Focus {
  agentName: string;
  prompt: string;
  fields: FocusField[];
  onComplete: FocusAction;
}
```

Fields are typed with validation:

```typescript
// packages/loft-definitions/src/shared/components/Agent.ts:119-134
export interface FocusField {
  key: string;
  type: FocusFieldType;          // STRING | NUMBER | BOOLEAN | ENUM | DATE
  required: boolean;
  description: string;
  default?: unknown;
  values?: string[];             // ENUM allowed values
  validate?: (value: unknown) => true | string;  // custom validator
}
```

### Example: Travel Intake Focus

```typescript
// examples/express-agents/src/loft/agents/intake.ts:11-38
const intakeFocus: Agent.Focus = {
  agentName: 'intake',
  prompt: 'Collect travel details from the user to plan their trip',
  fields: [
    { key: 'destination', type: Agent.FocusFieldType.STRING, required: true, description: 'Travel destination' },
    { key: 'travel_dates', type: Agent.FocusFieldType.DATE, required: true, description: 'Trip dates (ISO 8601)' },
    {
      key: 'budget', type: Agent.FocusFieldType.NUMBER, required: true,
      description: 'Trip budget in USD',
      validate: (v) => {
        const n = Number(v);
        return n > 0 && n < 1_000_000 ? true : 'Budget must be between $1 and $999,999';
      }
    },
    { key: 'travel_style', type: Agent.FocusFieldType.ENUM, required: true,
      values: ['budget', 'moderate', 'luxury', 'adventure'] },
    { key: 'group_size', type: Agent.FocusFieldType.NUMBER, required: true },
    { key: 'needs_visa', type: Agent.FocusFieldType.BOOLEAN, required: false, default: false }
  ],
  onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'dispatcher' }
};
```

### Tool Generation

Three tools are generated dynamically from the Focus definition:

```typescript
// packages/loft-agents/src/focus/FocusToolGenerator.ts:41-86
export function generateFocusTools(focus, focusStateStore, sessionId): Chat.AdditionalTool[] {
  return [updateTool, confirmTool, classifyTool];
}
```

| Tool | Purpose |
|------|---------|
| `update_<agentName>_focus` | Accept field key-value pairs, validate via coercion, store in FocusStateStore |
| `confirm_<agentName>_focus` | Return current status: filled fields, missing required fields, readiness |
| `classify_<agentName>_focus` | LLM self-classifies input as ON_FOCUS / OFF_FOCUS / UNKNOWN |

Tool schemas are generated from field definitions — ENUM fields get `enum` constraints in JSON schema, NUMBER fields get string type with description hint.

### Type Coercion Pipeline

All LLM tool inputs arrive as strings. Coercion converts them to the correct type:

```typescript
// packages/loft-agents/src/focus/FocusTypeCoercion.ts
export function validateField(value: unknown, field: FocusField): CoercionResult {
  const coerced = coerceValue(value, field);       // string → typed value
  if (!coerced.success) return coerced;
  if (field.validate) {                             // optional custom validator
    const result = field.validate(coerced.value);
    if (result !== true) return { success: false, error: result };
  }
  return coerced;
}
```

Coercion rules:
- `STRING` → pass through
- `NUMBER` → `Number(value)`, reject NaN
- `BOOLEAN` → `"true"/"false"` → boolean
- `ENUM` → check against `field.values`
- `DATE` → validate as ISO 8601 string

### Status Computation

```typescript
// packages/loft-agents/src/focus/FocusStatusComputer.ts:3-23
export function computeFocusStatus(focus, stored): FocusStatus {
  // For each field: check stored value or default
  // ready = no required fields missing
  return { agentName, filled, missing, hasData, ready };
}
```

Deterministic, no side effects. Called by both LoftAgentNode (to generate prompt) and tool handlers (to return feedback to LLM).

### Prompt Injection

Before each LLM call, Focus generates a system message with field definitions and current status:

```typescript
// packages/loft-agents/src/focus/FocusPromptGenerator.ts
// Output: markdown with field table + status summary
// Injected as augmentedContext with role: system, author: 'focus'
```

### FocusStateStore Interface

```typescript
// packages/loft-definitions/src/shared/components/Agent.ts:229-236
export interface FocusStateStore {
  get(sessionId: string, agentName: string, key: string): Promise<unknown | undefined>;
  set(sessionId: string, agentName: string, key: string, value: unknown): Promise<void>;
  getAll(sessionId: string, agentName: string): Promise<Record<string, unknown>>;
  delete(sessionId: string, agentName: string, key: string): Promise<void>;
  clear(sessionId: string, agentName: string): Promise<void>;
}
```

Default implementation: `InMemoryFocusStateStore` (nested Maps). Interface designed for persistent backends — a PostgreSQL implementation exists in `loft-session-pg-repository`.

### LoftAgentNode Integration

```
// packages/loft-agents/src/core/LoftAgentNode.ts:63-131
// 1. Fetch stored state → compute status → generate prompt + tools
// 2. Call loft.chat.generate() with additionalTools
// 3. Post-generate: recompute status
// 4. If ready:
//    a. Write focus data to SharedContext (focus:<agentName>)
//    b. If no text output (tool-only response), synthesize from stored data
//    c. Override transition per onComplete.target
```

### Execution Flow

```
User message → LoftAgentNode.run()
  ├── Fetch stored Focus state
  ├── Compute status (filled/missing/ready)
  ├── Generate Focus prompt + 3 tools
  ├── loft.chat.generate() with tools
  │     ├── LLM calls update_intake_focus({destination: "Barcelona"})
  │     ├── Tool handler validates + stores
  │     ├── LLM calls confirm_intake_focus()
  │     └── LLM generates text response asking for missing fields
  ├── Post-generate: recompute status
  ├── If ready: write to SharedContext, override transition
  └── Return { output, transition }
```

## Alternatives Considered

### Single Form Submission
- User provides all fields at once (like a web form)
- Rejected: Loses conversational context, bad UX for chat interfaces, users don't know all fields upfront

### Multi-Turn Without Progress Tracking
- LLM asks questions, extracts answers, but no unified status view
- Rejected: Hard to know when "done", no validation, no typed storage, prone to hallucinated completeness

### Schema Validation Only (Zod)
- Validate a complete object at the end
- Rejected: Can't handle progressive collection across turns; all-or-nothing validation doesn't work for chat

## Consequences

### Positive
- Natural conversation flow — LLM asks for missing fields in context
- Type safety via coercion pipeline — dates, numbers, enums validated before storage
- Custom validation per field — business rules enforced (budget range, etc.)
- Pluggable storage — swap InMemory for PostgreSQL without changing agent code
- Auto-transition on completion — no manual "is everything ready?" checks

### Negative
- Requires explicit field definitions per Focus node — no schema inference
- All tool inputs are strings (LLM limitation) — coercion adds complexity
- InMemoryFocusStateStore doesn't survive server restarts
- Multiple Focus nodes in one orchestrator must use distinct `agentName` values

## References

- `packages/loft-agents/src/focus/FocusToolGenerator.ts`
- `packages/loft-agents/src/focus/FocusStatusComputer.ts`
- `packages/loft-agents/src/focus/FocusTypeCoercion.ts`
- `packages/loft-agents/src/focus/FocusPromptGenerator.ts`
- `packages/loft-agents/src/focus/InMemoryFocusStateStore.ts`
- `packages/loft-agents/src/focus/UpdateFocusTool.ts`
- `packages/loft-agents/src/core/LoftAgentNode.ts` (Focus integration, lines 63-131)
- `packages/loft-definitions/src/shared/components/Agent.ts` (Focus types)
- `packages/loft-agents/src/__tests__/unit/FocusTools.test.ts`
- `packages/loft-agents/src/__tests__/unit/FocusTypeCoercion.test.ts`
- `packages/loft-agents/src/__tests__/unit/FocusStatusComputer.test.ts`
