---
'@moc-global/loft': minor
---

Tool handlers now get an optional second argument, `context`, with the `generate()` abort signal (`context.signal`) and an `emit(name, data)` function. `emit` is experimental: it sends a `data` event to a caller that streams the call with `onEvent`, and does nothing otherwise. Handlers that take only the arguments keep working. The abort signal also reaches MCP tool calls, both direct and through a tool interceptor's `executeToolFn`, each as a signal of the call's own that aborts with it. **Behaviour change:** aborting `generate()` during an MCP tool call now cancels that call: the MCP SDK sends the server a cancellation and rejects with an `McpError`, LOFT logs "Critical error during tool execution" at ERROR and adds an error tool result. Before, the MCP call ran to completion. The "Executing tool" debug log of `LlmManager` no longer includes the tool's arguments. MCP tool arguments are still logged at DEBUG by `MCPManager`.
