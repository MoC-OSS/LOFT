# How to Manage Context Window Size

As conversations grow, the number of messages sent to the LLM increases. LOFT provides `LlmContextWindowCropper` to control how many messages are included in each LLM call.

## The Problem

LLMs have token limits. Long conversations accumulate messages in chat history. Without cropping, every `generate()` call sends the entire history to the LLM, which can:

- Exceed the model's context window
- Increase latency and cost
- Include irrelevant early messages

## How Context Window Cropping Works

LOFT's `LlmContextWindowCropper` trims the message array to a target size while preserving **tool chain integrity** — it never splits a tool call from its result.

### Safe Crop Points

The cropper searches backward from the ideal crop point to find a safe boundary:

| Message Role | Safe to crop before? |
|-------------|---------------------|
| `user` | Always safe (natural conversation boundary) |
| `assistant` (no tools) | Safe (completed response) |
| `system` | Usually safe |
| `assistant` (with tool_calls) | Unsafe (would orphan tool calls) |
| `tool` | Unsafe (would orphan tool results) |

If the ideal crop point would break a tool chain, the cropper includes more messages to maintain integrity.

## Using llmContextWindow in generate()

Pass `llmContextWindow` to limit the number of messages sent to the LLM:

```typescript
const result = await loft.chat.generate({
  sessionId: session.id,
  directMessages: [...],
  llmContextWindow: 50    // Keep only the last ~50 messages
});
```

### How it works

1. `generate()` passes `llmContextWindow` through `temporaryRequestConfig`
2. In `LlmManager.generate()`, before each LLM call:
   ```
   messages = llmContextWindowCropper.crop(allMessages, targetSize)
   ```
3. The cropper keeps the newest `targetSize` messages (adjusted for tool chain integrity)
4. Setting `llmContextWindow: 0` (or omitting it) disables cropping — all messages are sent

### Example

With 200 messages in history and `llmContextWindow: 30`:

```
Messages 1-170:   [cropped — not sent to LLM]
Messages 171-200: [sent to LLM — last 30 messages]
```

If message 171 is a `tool` message (unsafe crop point), the cropper adjusts backward to include the preceding `assistant` message with its `tool_call`, resulting in 31+ messages.

When the cropper has to keep more messages than requested, it logs a `Chat history cropped` warning with the reason. If it finds no safe crop point at all, it keeps the whole history and logs an `EMERGENCY: No safe crop point found` warning. It also warns when the result has a tool call without its result, or the other way round.

## Custom Context Window Cropper

You can provide your own cropper implementation via `ChatConstructor`:

```typescript
import { Interface, Strategy } from '@moc-global/loft-definitions';

type ChatHistoryMessage = Interface.FacadeEntity.Message | Interface.FacadeEntity.InteractiveOutputMessage;

class MyCustomCropper implements Strategy.LlmContextWindowCropper {
  crop(messages: ChatHistoryMessage[], targetSize: number): ChatHistoryMessage[] {
    if (targetSize <= 0 || messages.length <= targetSize) {
      return [...messages];
    }

    // Your custom logic — e.g., summarize older messages instead of dropping them
    // Or keep all system messages plus the last N user/assistant messages

    return messages.slice(-targetSize);
  }
}

const chatConstructor = new ChatConstructor(
  sessionRepoConstructor,
  chatHistoryRepoConstructor,
  undefined,                  // chatHistoryPatcher (optional)
  new MyCustomCropper(),      // 4th parameter: custom cropper
  { mcp: { toolCacheTtl: 60000 } }
);
```

If you don't provide a custom cropper, LOFT uses the built-in `LlmContextWindowCropper` which handles tool chain integrity automatically.

## Recommendations

| Scenario | Suggested `llmContextWindow` |
|----------|------------------------------|
| Short conversations (<50 messages) | `0` (no cropping) |
| Medium conversations (50-200) | `50-100` |
| Long conversations (200+) | `30-50` |
| Cost-sensitive applications | `20-30` |
| Tool-heavy conversations | Higher values to preserve tool chains |

The optimal value depends on your model's context window, average message length, and cost tolerance. Monitor token usage via tracing to tune.
