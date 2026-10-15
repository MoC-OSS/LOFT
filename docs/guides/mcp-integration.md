# How to Integrate MCP Tools

LOFT supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) for connecting external tools to LLM conversations. When the LLM requests a tool call, LOFT executes it via MCP and feeds the result back to the LLM.

## Prerequisites

- `@modelcontextprotocol/sdk` installed (peer dependency of LOFT)
- An MCP server to connect to, or your own: see the MCP docs on [servers](https://modelcontextprotocol.io/docs/learn/server-concepts), [clients](https://modelcontextprotocol.io/docs/learn/client-concepts) and the [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## Registering MCP Clients

MCP clients are registered on the `ChatConstructor`, not `LoftConstructor`:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Create an MCP client
const transport = new StdioClientTransport({
  command: 'node',
  args: ['./my-mcp-server.js']
});

const mcpClient = new Client({ name: 'my-tools', version: '1.0.0' });
await mcpClient.connect(transport);

// Register with LOFT
await chatConstructor.useMcpClient('my-tools', mcpClient, {
  description: 'Custom tools for data processing'
});
```

Await each `useMcpClient()` call. A second call made while one is still running throws `useClient method is already running`.

Registration lists the client's tools straight away, so connect the client first. If listing fails, `useMcpClient()` throws and the client is not registered. There is no call to unregister a client.

### Client metadata

The third argument of `useMcpClient()` is optional metadata about the client. LOFT adds three fields to it:

| Field | Value |
|-------|-------|
| `transportType` | Detected from the transport: `stdio`, `sse`, `websocket`, `streamable-http`, otherwise the transport's class name in lower case without `transport` (`InMemoryTransport` → `inmemory`) |
| `registeredAt` | ISO timestamp of the registration |
| `toolCount` | Number of tools the client listed |

Your own fields are added after these, so they can override them. LOFT does not act on your fields (a `priority` or `rateLimit` field changes nothing by itself); tool interceptors see each client's metadata in `toolClients` (see below) and can route calls with it.

### Transports

Any MCP SDK client transport works, because LOFT only uses the connected `Client`. For tools that run in the same process, and for tests, link a client and a server in memory:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const server = new McpServer({ name: 'calculator', version: '1.0.0' });
server.registerTool(
  'add',
  { description: 'Add two numbers', inputSchema: { a: z.number(), b: z.number() } },
  async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] })
);

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);

const calculator = new Client({ name: 'loft', version: '1.0.0' });
await calculator.connect(clientTransport);
await chatConstructor.useMcpClient('calculator', calculator);
```

For remote servers, use the SDK's `StreamableHTTPClientTransport` (or `SSEClientTransport` for older servers; the SDK marks it deprecated). `WebSocketClientTransport` takes only a `URL`. A transport class of your own that implements the SDK's `Transport` interface also works.

### Multiple MCP Clients

You can register multiple MCP clients — LOFT merges their tool lists:

```typescript
await chatConstructor.useMcpClient('calculator', calculatorClient);
await chatConstructor.useMcpClient('weather', weatherClient);
await chatConstructor.useMcpClient('database', dbClient);
```

When two clients offer a tool with the same name:

- The LLM sees the tool once, with the description and schema of the client registered first. If the second client's description or schema differs, LOFT logs a warning. LOFT does not check arguments against that schema; each server validates its own.
- A call runs on every client that offers the tool, in parallel, unless an interceptor passes `clientNames` to `executeToolFn`. An empty `clientNames` means all clients; names that match none of the tool's clients return an error result.
- The successful results are combined into one: their `content` arrays are concatenated, and every other field (such as `structuredContent`) comes from the first successful result. Failed results are dropped.
- If every client fails, the result is an error. It carries the tools' own error text when they returned some, otherwise `Tool execution failed with errors: …`.

## How Tool Execution Works

During `generate()`, LOFT automatically:

1. Lists all available tools from registered MCP clients via `MCPManager.listTools()`
2. Includes them in the LLM request (formatted per provider)
3. If the LLM returns `tool_call` content parts, LOFT executes them via `MCPManager.callTool()`
4. Tool results are added to the context and the LLM is called again
5. This loop continues until the LLM returns a response without tool calls (or the loop limit is hit)

The loop limit is configurable via `ChatConfig.mcp.maxCallsPerGenerate` or the `LOFT_MCP_MAX_CALLS_PER_GENERATE` environment variable (default: 10). It counts LLM calls, not tool calls. When it is reached, the response is a message saying the tool call limit was reached, with `usage.finishReason` set to `max_loops_exceeded`.

If the LLM asks for a tool that no registered client offers, LOFT answers that call with an error tool result (`Tool "…" is not supported by any registered tool source`) and the loop goes on.

Every registered MCP tool is offered in every `generate()` call, whatever the manifest. To limit a tool to some manifests, refuse the call in an interceptor (see [Returning your own result](#returning-your-own-result)).

LOFT does not pass its context (session, history, user) to tools; a tool receives only the arguments the LLM wrote. To add context, use a tool interceptor.

## Tool Interceptors

A tool interceptor is a function that runs instead of the MCP call for one tool, named exactly. It decides whether and how the tool runs, and returns the tool result the LLM will see. Registering a second interceptor for the same tool name throws.

Because the interceptor owns the result, it can also change arguments or fill in defaults, pick clients, transform or cache results, apply your own rate limits, write an audit log, or fall back to another client when one fails.

```typescript
chatConstructor.registerToolInterceptor('my-tool-name', async ({ toolRequest, toolClients, executeToolFn }) => {
  // Run the tool as LOFT would, here on every client that offers it
  return executeToolFn({
    params: toolRequest.params,
    clientNames: toolClients.map((client) => client.clientName)
  });
});
```

### Interceptor Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ctx` | `ContextInterface` | The request context: `session`, `chatHistory`, `request`, `tracer`, `generate()`, `aiTask()`, `getPrompt()` |
| `toolRequest` | `ToolCallContent` | The tool call from the LLM: `params.name`, `params.arguments`, `callId` |
| `calledTool` | `Tool` | MCP tool definition: name, description and `inputSchema` (a JSON Schema) |
| `toolChain` | `Message[]` | All assistant + tool messages in the current loop, including the assistant message that asked for this call. Use it to reuse arguments or results from earlier calls |
| `executeToolFn` | `({ params, clientNames? }) => Promise<CallToolResult>` | Runs the tool on its MCP clients, or only on `clientNames` |
| `callLimits` | `{ current, max }` | The current iteration of the tool loop and the loop limit |
| `toolClients` | `Array<{ clientName, metadata }>` | MCP clients that offer this tool, with their metadata |
| `preventGenerate` | `(response) => void` | Ends the tool loop after this call and answers with `response` instead of calling the LLM again |

Interceptors run only for tools that come from registered MCP clients. To write an interceptor as a separate function, type it as `Interface.ToolInterceptor` (its argument is `Interface.ToolInterceptorParams`), from `@moc-global/loft-definitions`.

### Passing LOFT context to a tool

Add values from the context to the tool's arguments. The server tool must declare each added argument in its input schema, because an MCP server drops arguments it does not declare. The LLM then sees that argument too, and the interceptor overwrites whatever value the LLM sends:

```typescript
chatConstructor.registerToolInterceptor('lookup_order', async ({ ctx, toolRequest, executeToolFn }) =>
  executeToolFn({
    params: {
      ...toolRequest.params,
      // customerId is a field your application stores in the session's ctx
      arguments: { ...toolRequest.params.arguments, customerId: ctx.session.ctx.customerId }
    }
  })
);
```

### Returning your own result

Return a `CallToolResult` without running the tool, for example to refuse a call. Set `isError: true` so the LLM knows the tool did not run:

```typescript
chatConstructor.registerToolInterceptor('delete_record', async ({ ctx, toolRequest, executeToolFn }) => {
  if (!ctx.session.ctx.isAdmin) {
    return { isError: true, content: [{ type: 'text', text: 'Only administrators can delete records.' }] };
  }
  return executeToolFn({ params: toolRequest.params });
});
```

To allow a tool only for some manifests, check `ctx.request.messages.temporaryRequestConfig?.manifestName ?? ctx.session.currentManifestName` the same way.

If an interceptor throws, the request does not fail: LOFT sends the LLM an error tool result with the error message, and the loop goes on.

### Answering without another LLM call

Call `preventGenerate()` to finish the request with your own response once the tool has run. It takes the same argument as `chain.preventGeneration()` in middleware:

```typescript
import { Type } from '@moc-global/loft-definitions';

chatConstructor.registerToolInterceptor('book_meeting', async ({ toolRequest, executeToolFn, preventGenerate }) => {
  const result = await executeToolFn({ params: toolRequest.params });
  if (!result.isError) {
    preventGenerate({
      content: [{ type: 'text', text: 'Your meeting is booked.' }],
      role: Type.LLM.UnifiedMessageRole.assistant
    });
  }
  return result;
});
```

The tool's result stays in the response's `usedTools`. The response has `usage.finishReason` `interceptor_override`, zero token usage and `originalResponse.generatedByToolInterceptor` set to `true`. If the LLM asked for several tools in the same turn, the ones after this call do not run.

## Tool Cache TTL

MCP tool lists are cached to avoid repeated `listTools()` calls. Configure the TTL:

```typescript
const chatConstructor = new ChatConstructor(
  sessionRepo, chatHistoryRepo, undefined, undefined,
  { mcp: { toolCacheTtl: 120000 } }  // 2 minutes (default: 60000 = 1 min)
);
```

The cache is refreshed only when one of that client's tools is called after the TTL has passed; the tool list sent to the LLM is not refreshed on its own. A tool that a server adds later therefore reaches the LLM only after the TTL has passed and one of that client's tools has been called. If a refresh fails, LOFT keeps the previous list and tries again on the next call. `toolCacheTtl: 0` does not turn caching off; it falls back to the default.
