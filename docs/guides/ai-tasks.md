# AI Tasks

AI Tasks are standalone, single-shot LLM calls that run outside the main `generate()` pipeline. Use them when you need a quick LLM decision — intent classification, summarization, content extraction — without involving chat history, middleware, or MCP tools.

## When to Use AI Tasks vs generate()

| | `generate()` | `ctx.aiTask()` |
|---|---|---|
| **Purpose** | Conversational generation with full pipeline | One-off LLM call for a specific task |
| **Chat history** | Includes full conversation history | None — only the content you pass in |
| **Middleware** | Runs Input → BeforeGenerate → AfterGenerate | Not invoked |
| **MCP tools** | Full tool execution loop (multiple iterations) | None |
| **Input format** | `CreateMessage[]` (content parts array) | `string` or `Message[]` |
| **System message source** | `llmManifests` section in manifest | `aiTasks` section in manifest |
| **Computer manager** | GMComputerManager (`registerGMComputer`) | ATMComputerManager (`registerATMComputer`) |
| **Default priority** | 40 (via `ctx.generate()`) | 30 (via `ctx.aiTask()`) |

**Rule of thumb:** Use `generate()` for user-facing conversation. Use `aiTask()` for internal LLM decisions during request processing.

## Manifest Configuration

AI tasks are defined in the `aiTasks` section of your manifest JSON, alongside `llmManifests` and `prompts`. The structure mirrors `llmManifests` exactly: `aiTasks[taskName][llmName]` → `{ systemMessage, modelPreset }`.

```json
{
  "llmManifests": {
    "my-assistant": {
      "gpt-4o-mini": {
        "systemMessage": "You are a helpful assistant.",
        "modelPreset": { "model": "gpt-4o-mini", "temperature": 0.7, "max_tokens": 1000 }
      }
    }
  },
  "prompts": { },
  "aiTasks": {
    "classify-intent": {
      "gpt-4o-mini": {
        "systemMessage": "Classify the user's intent into one of: question, complaint, request, feedback. Reply with the classification only.",
        "modelPreset": { "model": "gpt-4o-mini", "temperature": 0, "max_tokens": 50 }
      }
    },
    "summarize": {
      "gpt-4o-mini": {
        "systemMessage": "Summarize the following text in one sentence.",
        "modelPreset": { "model": "gpt-4o-mini", "temperature": 0.3, "max_tokens": 200 }
      }
    },
    "analyze-sentiment": {
      "gpt-4o-mini": {
        "systemMessage": "Classify the sentiment of the text as positive, neutral or negative. Reply with one word.",
        "modelPreset": { "model": "gpt-4o-mini", "temperature": 0, "max_tokens": 5 }
      }
    }
  }
}
```

### Three Manifest Sections

The manifest has three parallel sections, each serving a different purpose:

| Section | Used by | Computer registration |
|---------|---------|----------------------|
| `llmManifests` | `generate()` — conversational generation | `registerGMComputer()` |
| `aiTasks` | `ctx.aiTask()` — standalone LLM tasks | `registerATMComputer()` |
| `prompts` | `ctx.getPrompt()` — text template retrieval | `registerPromptComputer()` |

`llmManifests` and `aiTasks` share the same schema (`{ systemMessage, modelPreset }`). `prompts` are simpler — just `prompts[name][llmName]` → string.

> **Note:** All three sections (`llmManifests`, `prompts`, `aiTasks`) are **required** in the manifest Zod schema. If you don't use AI tasks, include an empty object: `"aiTasks": {}`.

See [Manifests](./manifests.md) for the full manifest guide.

## ATM Computers (Runtime System Message Transformation)

Register an **ATM Computer** (AiTaskManifest Computer) to modify the AI task's system message at runtime, before it's sent to the LLM. This follows the same pattern as `registerGMComputer()` for the generate pipeline.

```typescript
loftConstructor.registerATMComputer(
  'classify-intent',    // aiTask manifest name
  'gpt-4o-mini',        // llmName
  async (ctx, prompt, modelPreset) => {
    // ctx: ContextInterface — full context including session, chatHistory, tracer
    // prompt: { name: string; content: string } — the system message from the manifest
    // modelPreset: optional model configuration from the manifest
    const userId = ctx.session.ctx.userId || 'unknown';
    return `${prompt.content}\n\nUser ID: ${userId}`;
  }
);
```

The callback signature is `PromptComputer<ContextInterface>`:

```typescript
type PromptComputer<PromptContext> = (
  promptCtx: PromptContext,
  prompt: Prompt,            // { name: string; content: string }
  modelPreset?: LLMManifestProps['modelPreset']
) => Promise<string>;
```

The computer receives the original `systemMessage` from the manifest (as `prompt.content`) and must return the modified system message as a string.

ATM Computers are optional. If none is registered for a given `aiTaskName + llmName` combination, the system message from the manifest is used as-is.

## Calling aiTask()

AI tasks are called via `ctx.aiTask()` on the `ContextInterface`, which is available inside middleware:

```typescript
const response = await ctx.aiTask(
  llmName,        // string — e.g., 'gpt-4o-mini'
  aiTaskName,     // string — manifest key, e.g., 'classify-intent'
  content          // string | Type.Entity.Message[]
);
```

### String Input (Simple)

Pass a plain string and LOFT wraps it in a message automatically:

```typescript
const result = await ctx.aiTask('gpt-4o-mini', 'classify-intent', 'I want a refund');
```

Internally, the string is wrapped into a `Message` object with `role: user` and `content: [{ type: 'text', text: '...' }]`. The system message comes from the AI task manifest.

### Message Array Input (Advanced)

For more control, pass an array of `Type.Entity.Message` objects:

```typescript
const result = await ctx.aiTask('gpt-4o-mini', 'classify-intent', [
  {
    id: 'msg-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    sequenceId: '',
    sessionId: ctx.session.id,
    content: [{ type: 'text', text: 'I want a refund for my last order' }],
    ctx: {},
    role: Type.LLM.UnifiedMessageRole.user,
    author: Type.LLM.UnifiedMessageRole.user,
    llmName: 'gpt-4o-mini',
    manifestName: 'classify-intent',
    llmIgnore: false
  }
]);
```

To give the task the recent conversation, pass messages from the history, oldest first:

```typescript
chatConstructor.registerBeforeGenerateMiddleware('summarize-recent', async (ctx, payload, chain) => {
  const summary = await ctx.aiTask('gpt-4o-mini', 'summarize', ctx.chatHistory.messages.slice(-10));
  chain.next();
  return payload;
});
```

In most cases, the string input is sufficient.

## Handling the Response

`ctx.aiTask()` returns a `Strategy.LLM.UnifiedLLMResponse`:

```typescript
import { Type } from '@moc-global/loft-definitions';

const result = await ctx.aiTask('gpt-4o-mini', 'classify-intent', 'I want a refund');

// Extract the text response
const textPart = result.topChoice.content.find(
  (part): part is Type.Entity.TextContent => part.type === 'text'
);
const classification = textPart?.text;  // e.g., 'complaint'
```

The response shape is the same as what you get from `generate()` inside `result.messages.llmResponse` — a `UnifiedLLMResponse` with `topChoice`, `choices`, `usage`, and `usedTools` fields.

## Common Use Cases

### Intent Classification (BeforeGenerate Middleware)

Route conversations to different behaviors based on the user's intent:

```typescript
chatConstructor.registerBeforeGenerateMiddleware('classify-and-route', async (ctx, payload, chain) => {
  // Get the latest user message
  const lastMessage = payload.directMessages[payload.directMessages.length - 1];
  const userText = lastMessage?.content
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join(' ');

  if (userText) {
    // Side-channel LLM call to classify intent
    const result = await ctx.aiTask('gpt-4o-mini', 'classify-intent', userText);
    const intent = result.topChoice.content.find(
      (p) => p.type === 'text'
    )?.text?.trim().toLowerCase();

    // Store classification in session context for downstream use.
    // Important: session.update({ ctx }) replaces the whole `ctx` object,
    // so spread the existing ctx to keep its other keys.
    await ctx.session.update({
      ctx: { ...ctx.session.ctx, lastIntent: intent }
    });

    // Optionally prevent generation for certain intents
    if (intent === 'complaint') {
      // Escalate — switch to a different manifest with a specialized system prompt
      await ctx.session.update({
        currentManifestName: 'escalation-handler'
      });
    }
  }

  chain.next();
  return payload;
});
```

### Content Summarization

Summarize earlier conversation before a main generation:

```typescript
chatConstructor.registerBeforeGenerateMiddleware('summarize-history', async (ctx, payload, chain) => {
  const historyMessages = ctx.chatHistory.messages;

  if (historyMessages.length > 20) {
    // Summarize the older messages via aiTask
    const olderText = historyMessages
      .slice(0, -10)
      .map(m => m.content.filter((p) => p.type === 'text').map((p) => p.text).join(' '))
      .join('\n');

    const summary = await ctx.aiTask('gpt-4o-mini', 'summarize', olderText);
    const summaryText = summary.topChoice.content.find(
      (p) => p.type === 'text'
    )?.text;

    // Inject summary as context for the main generation
    if (summaryText) {
      await ctx.session.update({
        ctx: { ...ctx.session.ctx, conversationSummary: summaryText }
      });
    }
  }

  chain.next();
  return payload;
});
```

### Sentiment Tagging

Tag messages with sentiment for analytics or routing:

```typescript
chatConstructor.registerAfterGenerateMiddleware('tag-sentiment', async (ctx, payload, chain) => {
  // payload is a Chat.GenerateResultMessages; the LLM's answer is payload.llmResponse
  const llmResponseText = payload.llmResponse.topChoice.content.find((p) => p.type === 'text')?.text;

  if (llmResponseText) {
    const sentiment = await ctx.aiTask('gpt-4o-mini', 'analyze-sentiment', llmResponseText);
    const sentimentText = sentiment.topChoice.content.find(
      (p) => p.type === 'text'
    )?.text?.trim();

    await ctx.session.update({
      ctx: { ...ctx.session.ctx, lastSentiment: sentimentText }
    });
  }

  chain.next();
  return payload;
});
```

## Complete Example

Here's a full setup with manifest, ATM computer, and middleware:

**1. Manifest** (`manifest/manifest.json`):

```json
{
  "llmManifests": {
    "customer-support": {
      "gpt-4o-mini": {
        "systemMessage": "You are a customer support agent. Be helpful and concise.",
        "modelPreset": { "model": "gpt-4o-mini", "temperature": 0.7, "max_tokens": 500 }
      }
    }
  },
  "prompts": {},
  "aiTasks": {
    "classify-intent": {
      "gpt-4o-mini": {
        "systemMessage": "Classify the user's intent into one of: question, complaint, request, feedback. Reply with the classification only, no explanation.",
        "modelPreset": { "model": "gpt-4o-mini", "temperature": 0, "max_tokens": 20 }
      }
    }
  }
}
```

**2. Application setup:**

```typescript
import 'reflect-metadata';
import { Interface, Type } from '@moc-global/loft-definitions';
import {
  ChatConstructor,
  FsRepositoryConstructor,
  LoftConstructor,
  ManifestManagerConstructor
} from '@moc-global/loft';
// ... LLM strategy and repository imports (see Quickstart guide)

// Create constructors
const manifestManagerConstructor = new ManifestManagerConstructor(
  new FsRepositoryConstructor(),
  { manifestPath: 'manifest/manifest.json', errorPath: 'manifest/errors', cacheExpirationTime: 60000 }
);

const chatConstructor = new ChatConstructor(
  sessionRepoConstructor,
  chatHistoryRepoConstructor
);

const loftConstructor = new LoftConstructor(
  { logLevel: Interface.LogLevel.INFO },
  manifestManagerConstructor,
  chatConstructor
);

// Register LLM strategy
await loftConstructor.registerLlmStrategy('gpt-4o-mini', openAiStrategy);

// Register ATM Computer — dynamically inject user context into the classification prompt
loftConstructor.registerATMComputer('classify-intent', 'gpt-4o-mini', async (ctx, prompt) => {
  const language = ctx.session.ctx.preferredLanguage || 'English';
  return `${prompt.content}\n\nRespond in ${language}.`;
});

// Register middleware that uses aiTask
chatConstructor.registerBeforeGenerateMiddleware('auto-classify', async (ctx, payload, chain) => {
  const lastMessage = payload.directMessages[payload.directMessages.length - 1];
  const userText = lastMessage?.content
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join(' ');

  if (userText) {
    const result = await ctx.aiTask('gpt-4o-mini', 'classify-intent', userText);
    const intent = result.topChoice.content.find(
      (p) => p.type === 'text'
    )?.text?.trim().toLowerCase();

    await ctx.session.update({
      ctx: { ...ctx.session.ctx, lastIntent: intent }
    });
  }

  chain.next();
  return payload;
});

// Use LOFT
const loft = loftConstructor.getInstance();

const session = await loft.chat.createSession({
  currentLlmName: 'gpt-4o-mini',
  currentManifestName: 'customer-support',
  ctx: { preferredLanguage: 'English' }
});

const result = await loft.chat.generate({
  sessionId: session.id,
  directMessages: [{
    content: [{ type: 'text', text: 'I want a refund for my last order' }],
    role: Type.LLM.UnifiedMessageRole.user,
    author: 'user',
    sessionId: session.id,
    llmName: 'gpt-4o-mini',
    manifestName: 'customer-support',
    ctx: {},
    llmIgnore: false
  }]
});

// The middleware classified intent before the main generation ran
console.log('Intent:', (await loft.chat.getSessionById(session.id)).ctx.lastIntent);
// → "complaint"
```

## Execution Flow

When `ctx.aiTask()` is called, the following happens:

```
ctx.aiTask(llmName, aiTaskName, content)
  │
  ├── 1. Convert string to Message[] (if string input)
  │
  ├── 2. ManifestManager.getAiTaskManifest(aiTaskName, llmName)
  │      → { systemMessage, modelPreset }
  │
  ├── 3. ATMComputerManager.compute(ctx, systemMessage, ...)
  │      → computedSystemMessage (applies registered ATM Computer, if any)
  │
  ├── 4. llmStrategy.prepareGenerateRequest(...)
  │      (no MCP tools — empty array)
  │
  ├── 5. llmStrategy.generate(request)
  │      (single LLM call — no tool loop)
  │
  └── 6. llmStrategy.formatToUnifiedLLMResponse(...)
         → UnifiedLLMResponse
```

Note that `aiTask()` does **not** call `llmStrategy.executeMiddlewareChain()` — strategy-level middleware only runs for `generate()`, not for AI tasks.

## What's Next

- [Manifests](./manifests.md) — Full manifest guide including storage backends and all three computer types
- [Middleware](./middleware.md) — How to write and register middleware (where you'll typically call `aiTask()`)
- [Processing Pipeline](../concepts/processing-pipeline.md) — The full `generate()` request lifecycle
