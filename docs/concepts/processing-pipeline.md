# Processing Pipeline

This page describes how a request flows through LOFT from `generate()` call to response, including the middleware chain, LLM call, and MCP tool execution loop.

## Overview

When you call `loft.chat.generate()`, the request passes through this pipeline:

```
generate({ sessionId, directMessages, ... })
  │
  ├── 1. Load session from SessionRepository (unless a ctx is passed in)
  ├── 2. Build ContextInterface (session, chatHistory, request, tracer)
  │
  ├── 3. Validate directMessages and augmentedContext (Zod schema)
  │
  ├── 4. INPUT MIDDLEWARE CHAIN
  │      Transform incoming messages
  │
  ├──    FOCUS (when active)
  │      Add the focus prompt and the focus tools
  │
  ├── 5. BEFORE-GENERATE MIDDLEWARE CHAIN
  │      Pre-process (can prevent LLM call and return custom response)
  │
  ├── 6. LLM MANAGER
  │      ├── Resolve LLM strategy by name
  │      ├── Load manifest (system message + model preset)
  │      ├── Apply prompt computers
  │      ├── Get tools: MCP, additional and Focus tools
  │      ├── ┌─── TOOL EXECUTION LOOP ───┐
  │      │   │ Call LLM                   │
  │      │   │ If LLM requests tools:     │
  │      │   │   Run them, one by one     │
  │      │   │   Add results to context   │
  │      │   │   Call LLM again           │
  │      │   └── Until no tools needed ───┘
  │      ├── Strategy output middleware (once)
  │      └── Return UnifiedLLMResponse
  │
  ├── 7. AFTER-GENERATE MIDDLEWARE CHAIN
  │      Post-process LLM response
  │
  └── 8. Return GenerateResult (nothing is stored until result.messages.save())
```

## Step-by-Step Walkthrough

### 1. Session and Context Loading

When `generate()` is called, LOFT first loads the session and builds a `ContextInterface`:

```typescript
// From BaseLoftChat.generate()
const ctx = await this.contextProvider.get(sessionId);
```

The `ContextInterface` contains:

| Field | Type | Description |
|-------|------|-------------|
| `session` | `Type.Entity.Session` | The session object with `currentLlmName`, `currentManifestName`, `ctx` |
| `chatHistory` | `{ messages: Message[] }` | The session's stored messages (the latest `ChatConfig.historyLimit` when set) |
| `request` | `RequestContext` | Current request: `correlatorIds`, `messageIds`, `messages` (direct + augmented) |
| `tracer` | `Strategy.Tracer.Tracer` | Tracing/observability interface |

The context is available to all middleware and is updated between stages.

### 2. Input Validation

Direct messages and augmented context are validated against the `CreateMessage` Zod schema before processing:

```typescript
const { success, error, data } = Schema.Entity.CreateMessage.array().safeParse(directMessages);
if (!success) {
  throw new GenerateError(sessionId, [], [], Chat.Status.ERROR, 'Invalid direct messages', error);
}
```

The `content` field in each message must be an array of content parts:
```typescript
content: [{ type: 'text', text: 'Hello!' }]  // correct
content: 'Hello!'                              // WRONG — will fail validation
```

### 3. Input Middleware

The first middleware stage transforms the incoming request. Input middleware receives the validated `directMessages` and `augmentedContext`:

```typescript
const { payload: processedInput } = await this.inputMiddlewareManager.executeChain(
  ctx,
  { augmentedContext, directMessages },
  correlatorIds
);
```

Input middleware also runs in `addMessages()`, before the messages are stored, so in the `addMessages()` → `generate()` pattern it runs twice. While it runs, `context.request.messages` is still empty: the request is in the payload.

Each middleware function receives `(context, payload, chain)`, returns the payload, and calls `chain.next()` to let the next middleware run:

```typescript
async (context, payload, chain) => {
  // Modify payload.directMessages or payload.augmentedContext
  chain.next();
  return payload;
}
```

### 4. BeforeGenerate Middleware

This stage runs after input processing but before the LLM call. It has a unique capability: it can **prevent the LLM call entirely** and return a custom response:

```typescript
const { payload, isGenerationPrevented, overrideGenerateResponse } =
  await this.beforeGenerateMiddlewareManager.executeChain(ctx, generateRequestParameters, correlatorIds);
```

BeforeGenerate middleware can:
- **Continue normally**: `chain.next(); return payload;`
- **Prevent generation**: `chain.preventGeneration({ content, role }); return payload;` — skips the LLM call and uses that content as the response. The AfterGenerate middleware still runs on it

Use cases for preventing generation: cached responses, content filters that block certain requests, or routing to a different system.

### 5. LLM Manager Generate

This is the core of the pipeline. The `LlmManager.generate()` method:

1. **Resolves the LLM strategy** by name (from session or temporary override)
2. **Loads the manifest** via `ManifestManager.getLlmManifest(manifestName, llmName)` — returns `{ systemMessage, modelPreset }`
3. **Applies prompt computers** via `ComputerManager.compute()` — allows dynamic system message modification
4. **Gets the tools**: MCP tools via `MCPManager.listTools()`, plus the `additionalTools` passed to `generate()` and the tools of an active Focus
5. **Enters the tool execution loop** (see below), with the chat history, the augmented context and the direct messages. Messages that agents, the orchestrator and Focus stored are left out of the history
6. **Runs the strategy's output middleware** (`useMiddleware` on the LLM strategy) once, on the final response

### 6. Tool Execution Loop

When the LLM requests tool calls, LOFT enters an execution loop. Additional and Focus tools run in process; MCP tools run through `MCPManager`, and a tool interceptor registered for the tool name can wrap the call:

```
┌─────────────────────────────────────────────┐
│                                             │
│  Prepare context window (history + tools)   │
│              ↓                              │
│  Apply context window cropping              │
│              ↓                              │
│  Format and send request to LLM             │
│              ↓                              │
│  Parse unified response                     │
│              ↓                              │
│  Does response contain tool_call content?   │
│     │                          │            │
│     No                         Yes          │
│     ↓                          ↓            │
│  Exit loop              Execute each tool,  │
│                         one after another   │
│                                ↓            │
│                         Add assistant msg   │
│                         + tool results to   │
│                         context             │
│                                ↓            │
│                         Loop limit check    │
│                         (maxCallsPerGenerate│
│                          default: 10)       │
│                                ↓            │
│                         ┌──────────────┐    │
│                         │ Loop back to │    │
│                         │ LLM call     │    │
│                         └──────────────┘    │
└─────────────────────────────────────────────┘
```

Key details:
- The loop has a configurable limit (`ChatConfig.mcp.maxCallsPerGenerate`, default 10)
- If the limit is exceeded, LOFT returns a system message explaining the limit was reached
- Tool interceptors can prevent further LLM generation and return custom responses
- Unavailable tools get error responses to maintain the tool call/response balance
- Each iteration creates tracing spans for observability

### 7. AfterGenerate Middleware

After the LLM response (and any tool execution), the response passes through after-generate middleware:

```typescript
const { payload: outputMessages } = await this.afterGenerateMiddlewareManager.executeChain(
  ctx,
  response,     // GenerateResultMessages
  correlatorIds
);
```

The payload at this stage is `Chat.GenerateResultMessages`, containing:
- `directMessages` — The user's original messages (processed)
- `augmentedContext` — Any augmented context messages
- `llmResponse` — The `UnifiedLLMResponse` with `topChoice`, `choices`, `usage`, `usedTools`

### 8. Return Result

The final `GenerateResult` returned to your application:

```typescript
interface GenerateResult {
  ctx: ContextInterface;            // The final context (with updated request state)
  sessionId: string;
  correlatorIds: string[];
  messageIds: { augmentedContext: string[]; directMessages: string[]; all: string[] };
  status: Chat.Status;              // Always SUCCESS; failures (ERROR, ALREADY_GENERATED) are thrown as GenerateError.status
  messages: GenerateResultMessages;
  focusStatus?: Agent.FocusStatus;  // When a Focus is active
}
```

`generate()` stores no messages. Call `result.messages.save()` to store the direct messages, the augmented context, the tool calls and results, and the reply, as the AfterGenerate middleware left them. Focus state is stored as the Focus tools run, and a completed Focus is cleared from the store during `generate()`, and, when it is the session's own Focus, from the session too (see [Agent Orchestration](../guides/agents.md#4-focus--structured-data-collection)).

With `onEvent`, the same call also reports its progress as events while it runs: `start` after the BeforeGenerate middleware, a step for each LLM call with its text and tool calls, and a final `finish` after the AfterGenerate middleware, or `error` or `abort`. The result is the same. See [Streaming](../guides/streaming.md).

## Middleware Execution Details

### Chain Behavior

- Middleware executes **sequentially** in registration order
- The return value of each middleware is deep-copied (via `fast-copy`) before being passed to the next middleware — this prevents one middleware from inadvertently mutating the payload seen by subsequent middleware
- Middleware calls `chain.next()` to let the next middleware run; without it the chain stops, and the payload it returned is still used
- If a middleware throws, the chain stops and the error propagates
- Duplicate middleware names throw an error at registration time

### Tracer Spans

LOFT creates tracer spans at multiple levels:
- One span per `generate()` call (`chat/generate`)
- One span per middleware run (`middleware/{type}/{name}`), with the payload it received
- One span per LLM operation (`llm-operation/{manifestName}/{llmName}`)
- One span per prompt computer run (`computer/{type}/{name}`)
- One generation per LLM API call (with model, usage, cost tracking)
- One span per MCP tool execution (`mcp-tool-{toolName}`)
- One span per additional tool call (`additional-tool-{toolName}`)

See [Tracing](../guides/tracing.md) for the full list.

All spans are nested — tool spans are children of the generation span, which is a child of the LLM operation span.

## Temporary Request Configuration

You can override the session's LLM name and manifest name for a single request:

```typescript
const result = await loft.chat.generate({
  sessionId: session.id,
  directMessages: [...],
  temporaryLlmName: 'gpt-4o',            // Override session's currentLlmName
  temporaryManifestName: 'detailed-bot',  // Override session's currentManifestName
  llmContextWindow: 50                    // Limit context to last 50 messages
});
```

These temporary values:
1. Are passed through the middleware chain in `temporaryRequestConfig`
2. Override session values only for this request
3. Are NOT persisted to the session

## Other Chat Methods

Beyond `generate()`, the chat interface exposes:

| Method | Description |
|--------|-------------|
| `createSession(options)` | Create a new session in the database |
| `deleteSession(sessionId)` | Delete a session. Its messages stay in the chat history ([details](../guides/chat-persistence.md#5-using-sessions)) |
| `getSessionById(sessionId)` | Retrieve a session |
| `getSessionByExternalKey(key)` | Retrieve a session by external identifier |
| `updateSessionSettings(sessionId, correlatorId, settings)` | Update session configuration (deep-merges `ctx`) |
| `getChatHistory(sessionId)` | Get conversation history as a queryable object |
| `addMessages(sessionId, correlatorIds, messages)` | Add messages to chat history (runs through Input middleware) |
| `checkHealth()` | Health check for session repo, chat history, and LLM manager |
| `shutdown()` | Graceful shutdown — waits for active operations to complete |

## What's Next

- **[Dependency Injection](./dependency-injection.md)** — How all these components are wired together
- **[Strategy Pattern](./strategy-pattern.md)** — How LLM providers and storage are pluggable
- **[DI Symbols Reference](../reference/di-symbols.md)** — Complete symbol table
