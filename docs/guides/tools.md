# Additional Tools

An additional tool is a function you hand to a single `generate()` call. The LLM sees it next to your MCP tools and can ask for it; LOFT then runs your handler in-process, with no MCP server involved. Use one when the tool needs data that only exists in the current request, such as the signed-in user's account.

For tools that live on an MCP server, see [MCP Integration](./mcp-integration.md).

## Defining a Tool

An additional tool has a `definition`, which the LLM reads, and a `handler`, which LOFT calls:

```typescript
import { Chat } from '@moc-global/loft-definitions';

const getOrderStatus: Chat.AdditionalTool = {
  definition: {
    name: 'get_order_status',
    description: 'Looks up the status of an order by its number',
    inputSchema: {
      type: Chat.AdditionalToolSchemaType.OBJECT,
      properties: { orderNumber: { type: 'string' } },
      required: ['orderNumber']
    }
  },
  async handler(args) {
    const status = await orders.statusOf(String(args.orderNumber));
    return { content: [{ type: Chat.AdditionalToolContentType.TEXT, text: status }] };
  }
};
```

Pass it in `additionalTools`:

```typescript
const result = await loft.chat.generate({
  sessionId,
  directMessages,
  additionalTools: [getOrderStatus]
});
```

Tools passed this way exist for that call only. If an MCP tool has the same name, a call to that name goes to the additional tool, so give each tool a name of its own.

## The Handler

```typescript
handler(args: Record<string, unknown>, context?: AdditionalToolContext): Promise<AdditionalToolResult>
```

- `args` holds the arguments the LLM wrote. The values are not validated against `inputSchema`, so check them before you use them.
- The result is `{ content: [{ type: 'text', text }], isError? }`. Set `isError: true` to tell the LLM the tool failed; it can then answer or try again.
- A handler that throws does not fail `generate()`. LOFT answers the LLM with an error result that says `Critical execution error:` and the error's message, and the loop goes on.
- LOFT's tool-execution log does not include the argument values of an additional tool. The tracer records them as the input of the tool's span, and the arguments of an MCP tool are logged at DEBUG. A tool may receive personal data, so take the same care in your own logging and tracing.

## The Context

LOFT passes a second argument, `context`, on every call:

```typescript
interface AdditionalToolContext {
  signal?: AbortSignal;
  emit(name: string, data: unknown): void;
}
```

The parameter is optional in the type, so a handler that takes only `args` keeps working, and so does code that calls `handler(args)` directly, such as a unit test. A handler can also declare `context` as required, because `handler` is declared as a method.

### `signal`

`signal` is the abort signal you passed to `generate()`. It aborts when the caller cancels, so a tool that makes a slow call can stop with it. Pass it on to anything that accepts one:

```typescript
async handler(args, context) {
  const response = await fetch(`https://api.example.com/orders/${encodeURIComponent(String(args.orderNumber))}`, {
    signal: context?.signal
  });
  const order = await response.json();
  return { content: [{ type: Chat.AdditionalToolContentType.TEXT, text: JSON.stringify(order) }] };
}
```

`signal` is `undefined` when the `generate()` call had none.

### `emit`

`emit(name, data)` (experimental) sends a `data` event to a caller that [streams](./streaming.md) the `generate()` call with `onEvent`, for example to show the tool's progress:

```typescript
async handler(args, context) {
  context?.emit('progress', { stage: 'loading' });
  const order = await orders.find(String(args.orderNumber), { signal: context?.signal });
  context?.emit('progress', { stage: 'done' });
  return { content: [{ type: Chat.AdditionalToolContentType.TEXT, text: JSON.stringify(order) }] };
}
```

- The caller receives `{ type: 'data', step, toolCallId, toolName, name, data }`. LOFT adds the step, the tool call id and the tool name, and sends the event between the tool's `tool-call` and `tool-result` events.
- `emit` does nothing when the caller passed no `onEvent`, once the tool has returned, and after the `generate()` call has ended. A handler can call it whether or not anyone listens.
- `data` events are never saved to the chat history. Put whatever must be kept into the tool's result.
- LOFT does not validate or log the payload, and sends it even when the caller holds the reply text back until the middleware has run. Do not put model output, secrets or personal data in it that the client must not see.
- Only additional tools can emit; MCP tools cannot.

## Binding `this`

LOFT takes the handler out of the tool object and calls it on its own, so `this` is not the object. A class-based tool that uses `this` in its handler must bind it:

```typescript
class OrderTool implements Chat.AdditionalTool {
  readonly definition = {
    name: 'get_order_status',
    description: 'Looks up the status of an order by its number',
    inputSchema: { type: Chat.AdditionalToolSchemaType.OBJECT }
  };

  constructor(private readonly orders: OrderService) {}

  handler = async (args: Record<string, unknown>) => {
    const status = await this.orders.statusOf(String(args.orderNumber));
    return { content: [{ type: Chat.AdditionalToolContentType.TEXT as const, text: status }] };
  };
}
```

An arrow function property, as above, or `handler: this.handle.bind(this)` both work. An object literal with a method that does not use `this`, like the first example, needs nothing.

## MCP Tools

Tools from MCP servers get the same signal: LOFT passes it in the request options of every MCP tool call, also when a tool interceptor runs the call through `executeToolFn`. See [MCP Integration](./mcp-integration.md).
