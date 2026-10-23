# ADR-002: Guard Middleware — A Package That Wraps What LOFT Is Given

## Status

Proposed

## Context

Applications want to change what flows through a conversation: redact personal data (PII) and detect prompt injection. LOFT runs three chat middleware chains (Input, BeforeGenerate, AfterGenerate), each once per `generate()` call. Middleware is registered as separate functions, one `register*` call each.

Data also flows around those chains:

| Channel | Where it bypasses the chains |
|---|---|
| Tool results | Additional and MCP tool results go to the model and into the saved tool messages without passing a chain (`packages/loft/src/managers/toolExecution.ts`). The only tool hook, `registerToolInterceptor`, covers one MCP tool name |
| Traces | Every middleware span records the payload it received. The `generate()` trace recorded the raw request in its metadata. Generation spans carry the raw provider response, and tool spans carry arguments and error text |
| Logs | `addMessages()` logged the raw messages at trace level |
| Streamed text | Middleware can hold streamed text back (text policy `'after-middleware'`) but cannot rewrite it |

Other frameworks put this inside the agent loop. LangChain JS (`langchain` 1.x, [middleware docs](https://docs.langchain.com/oss/javascript/langchain/middleware/custom)) has `beforeModel`, `wrapModelCall`, `afterModel` and `wrapToolCall`, which run on every model or tool call. Mastra ([processors](https://mastra.ai/docs/agents/processors)) has input and output processors with a built-in `PIIDetector` and `PromptInjectionDetector`. Copying LangChain's model would add a large core API: graph-style hooks, state schemas and jump declarations.

Requirements:

- Close the channels above for PII and injection without breaking any existing API.
- Ship each guard as one object that covers every channel, so that an application does not assemble the parts itself.
- Simple, one-file middleware (logging, tagging) should stay a copy-paste recipe, not a package.

## Decision

A new package, `@moc-global/loft-middleware`, holds guard middleware. It reaches each channel through objects the application already gives LOFT, so core gets no new hook API:

```
LoftMiddleware { name, input?, beforeGenerate?, afterGenerate?, afterGenerateTransformsOutput?,
                 toolResult?, toolList?, maskTrace? }

applyMiddleware(chatConstructor, middleware)                → registerInputMiddleware / registerBeforeGenerateMiddleware /
                                                              registerAfterGenerateMiddleware (public methods)
guardMcpClient(client, middleware, { serverName })          → wraps client.callTool and client.listTools, before useMcpClient
guardTool(tool, middleware), guardTools(tools, middleware)  → wraps an additional tool's handler
maskTracerFactory(factory, middleware)                      → wraps the TracerFactory passed to LoftConstructor
maskTracer(tracer, middleware)                              → wraps a Tracer, such as the one given to the agents' OrchestratorBuilder
```

- A `LoftMiddleware` is plain data. The wrappers apply the parts that concern them, so the same array goes to every wrapper.
- Every wrapper takes the middleware as an array, so that an options argument can follow it, as `serverName` does for `guardMcpClient`, without a breaking change.
- Every wrapper applies the middleware in the order given.
- The trace mask copies the values it rewrites and never changes the objects LOFT passes to the tracer. It rewrites object keys and numbers too.
- A missed wrapper is a silent gap, so `applyMiddleware` warns once, on the first request, when a middleware masks traces and the chat's tracer does not apply its mask. The tool wrappers have no such check: LOFT does not show middleware which tools a request has.
- LOFT runs chat middleware in registration order, and a middleware that does not call `chain.next()` ends the chain, so the guards are applied before the application's own middleware.
- The package declares `@moc-global/loft` and `@moc-global/loft-definitions` as peer dependencies: it needs the releases that add `transformsOutput` and the two fixes below.

Core gets two small fixes that no wrapper can make:
- `addMessages()` logs message counts instead of the messages;
- the `generate()` trace no longer repeats the raw request in its metadata. Its `input` already holds the request after the Input middleware.

The package starts with two guards:

- **`piiRedaction(options)`.**
  - Detection is synchronous pattern matching with validation, in linear time. The defaults are e-mail addresses, payment card numbers (Luhn) and IBANs (country length and mod-97). IP addresses are opt-in.
  - By default it masks traces only.
  - Redacting user input, tool results and the reply are opt-in, because redaction at rest removes the real values for good. Redacting the reply makes streamed text wait for the whole reply.
  - Detectors are synchronous because tracer calls are synchronous.
- **`injectionGuard(options)`.**
  - The Input middleware, which runs on `addMessages()` and on `generate()`, detects an attack in a user message. It replaces the message's text, records the finding in `message.ctx.loftGuard`, and marks the message `llmIgnore`.
  - BeforeGenerate then stops the call when the newest user message carries that record: by default with a fixed reply, or optionally by throwing `InjectionDetectedError`.
  - Tool results that look like an attack are withheld. MCP tools whose description looks like one are left out of the tool list.
  - The default detector is heuristic. Detectors are pluggable and may be asynchronous, with a timeout. A failing detector counts as a finding unless `onDetectorError: 'allow'`.
  - Checking the augmented context, such as retrieved documents, is opt-in.

The package is private until an application adopts it. Simple recipes live in `examples/middleware/`.

## Alternatives Considered

### New core hooks (a tool-result chain, `chat.use()`, a trace mask in `ChatConfig`)
- A fourth middleware chain at the tool-result sites, a bundle method on `ChatConstructor`, and a mask option in the chat config.
- Rejected for now: the wrappers close the same channels with no new API. A `chat.use()` could not deliver a trace mask anyway, because the tracer factory is bound in the LOFT container and the chat config is fixed at construction. Each hook can still be added later if the wrappers prove awkward.

### Hooks per model call, like LangChain's `beforeModel` and `wrapModelCall`
- Rejected for now. They are needed for "the provider never sees PII but history keeps the real values" and for cleaning history stored earlier. Neither is in scope, and the change is large.

### Block injection only in BeforeGenerate
- Rejected. With `addMessages()` followed by `generate()`, the message is stored before BeforeGenerate runs, and every later turn would send it again.

### A copy-in CLI registry
- Rejected until there are many middlewares. Copied security code does not receive fixes.

## Consequences

### Positive
- No breaking change. The core change is two log and trace fixes.
- One object per guard covers input, tools, traces and output.
- What each guard does not protect against is documented, and the leak test checks every channel it claims.

### Negative
- An application must wrap its tracer factory, MCP clients and additional tools; `applyMiddleware` alone covers only the chat chains. Only a missed tracer wrapper is reported.
- The order of the guards among the application's own middleware is up to the application.
- Text that streams as it arrives is not redacted: reasoning, the reply under the text policy `'all'`, and the `data` events of tools.
- Focus tools and `aiTask()` calls are not covered.
- Redacting the reply holds back streamed text until the end.
- Detection is heuristic and can be bypassed. It is one layer of defence, not a sandbox.

## References

- `packages/loft-middleware/` — the package
- `packages/loft/src/workflows/chat/BaseLoftChat.ts` — the chains and the two fixes
- `packages/loft/src/managers/toolExecution.ts`, `packages/loft/src/managers/MCPManager.ts` — the tool paths the wrappers cover
- [ADR-001](001-chat-streaming.md) — the text policy that holds streamed text for transforming middleware
- [Middleware guide](../../guides/middleware.md)
