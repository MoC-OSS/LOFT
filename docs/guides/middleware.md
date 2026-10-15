# How to Write and Register Middleware

LOFT's middleware pipeline lets you add custom logic before and after LLM calls. This guide shows how to write and register middleware for each stage.

## Overview

There are three middleware stages, each registered on the `ChatConstructor`:

| Stage | Method | When it runs | Payload type |
|-------|--------|-------------|-------------|
| **Input** | `registerInputMiddleware()` | Before anything else — transforms incoming messages | `GenerateRequestParameters` |
| **BeforeGenerate** | `registerBeforeGenerateMiddleware()` | After input processing, before LLM call | `GenerateRequestParameters` |
| **AfterGenerate** | `registerAfterGenerateMiddleware()` | After LLM response | `Chat.GenerateResultMessages` |

## Writing Middleware

Every middleware function has the same signature:

```typescript
async (context, payload, chain) => {
  // 1. Read or modify the payload
  // 2. Call chain.next() to let the next middleware run
  chain.next();
  // 3. Return the payload; the next middleware and the pipeline receive what you return
  return payload;
}
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `context` | `ContextInterface` | The request context: `session`, `chatHistory`, `request`, `tracer` |
| `payload` | varies per stage | The data being processed (messages, LLM response, etc.) |
| `chain` | `StandardChainStrategy` (`BeforeGenerateChainStrategy` in BeforeGenerate) | Controls flow — call `next()` to let the next middleware run |

### Rules

- **Return the payload** — the value you return is what the next middleware and the pipeline receive. `chain.next()` takes no arguments and returns nothing, so `return chain.next()` would pass `undefined` on
- **Call `chain.next()`** to let the next middleware run. If you don't, the chain stops after your middleware, and the payload you returned is still used. Stopping the chain does not stop the request: the LLM is still called. To stop it, throw, or use `chain.preventGeneration()` in BeforeGenerate
- **Names must be unique** — registering a duplicate name throws an error
- **Sequential execution** — middleware runs in registration order
- **Immutable between steps** — the return value is deep-copied (via `fast-copy`) before passing to the next middleware
- **Errors stop the request** — if a middleware throws, the chain stops and throws `Forced failure in middleware: <name>`, with your error as its `cause`. `generate()` wraps that error in a `GenerateError` (as its `cause`); `addMessages()` throws it as is (see [Error handling](./error-handling.md#common-causes)). For optional steps, catch errors yourself (see [Optional steps](#optional-steps-that-must-not-fail-the-request))
- **Every step adds latency** — middleware runs one step at a time and each return value is deep-copied, so keep steps light. An LLM call in Input middleware runs twice in the multi-turn pattern (see below)

## Input Middleware

Transforms incoming messages before they're processed.

> **Important:** InputMiddleware fires on **both** `chat.addMessages()` and `chat.generate()` calls. If your application uses the multi-turn pattern (`addMessages` → `generate` → `save`), the InputMiddleware will execute **twice** per chat request — once when storing the user message and once before generation. Design your middleware to be idempotent or account for this double invocation.

```typescript
chatConstructor.registerInputMiddleware(
  'sanitize-input',
  async (context, payload, chain) => {
    // payload.directMessages — the user's messages
    // payload.augmentedContext — additional context messages

    // Example: strip HTML from all text content
    payload.directMessages = payload.directMessages.map(msg => ({
      ...msg,
      content: msg.content.map(part =>
        part.type === 'text' ? { ...part, text: stripHtml(part.text) } : part
      )
    }));

    chain.next();
    return payload;
  }
);
```

## BeforeGenerate Middleware

Runs after input processing, before the LLM call. Has a unique capability: **preventing the LLM call entirely**.

### Standard usage — modify the request

```typescript
import { Type } from '@moc-global/loft-definitions';

chatConstructor.registerBeforeGenerateMiddleware(
  'inject-system-context',
  async (context, payload, chain) => {
    // Access session data
    const { session } = context;
    const userTimezone = session.ctx.timezone;

    // Modify augmented context
    payload.augmentedContext.push({
      content: [{ type: 'text', text: `User timezone: ${userTimezone}` }],
      role: Type.LLM.UnifiedMessageRole.system,
      author: 'system',
      sessionId: session.id,
      llmName: session.currentLlmName,
      manifestName: session.currentManifestName,
      ctx: {},
      llmIgnore: false
    });

    chain.next();
    return payload;
  }
);
```

### Preventing generation

```typescript
import { Type } from '@moc-global/loft-definitions';

chatConstructor.registerBeforeGenerateMiddleware(
  'cache-check',
  async (context, payload, chain) => {
    const cached = await checkCache(context.session.id, payload.directMessages);

    if (cached) {
      // Answer from the cache; the LLM is never called
      chain.preventGeneration({
        content: cached.content,
        role: Type.LLM.UnifiedMessageRole.assistant
      });
      // Not calling chain.next() skips the remaining BeforeGenerate middleware
      return payload;
    }

    chain.next();
    return payload;
  }
);
```

`chain.preventGeneration()` takes one argument, the response to use instead of the LLM's:
- `content` — array of content parts (e.g., `[{ type: 'text', text: '...' }]`)
- `role` — message role, usually `Type.LLM.UnifiedMessageRole.assistant`
- `llmName` — optional, defaults to the request's or the session's LLM name
- `manifestName` — optional, defaults to the request's or the session's manifest name

Generation stays prevented even if a later BeforeGenerate middleware runs. The AfterGenerate middleware still runs, on the override response.

### Accessing chat history

```typescript
chatConstructor.registerBeforeGenerateMiddleware(
  'check-history',
  async (context, payload, chain) => {
    // Full conversation history is on the context
    const messages = context.chatHistory.messages;
    const messageCount = messages.length;

    // Use context.tracer for observability
    const span = context.tracer.span({ name: 'check-history', input: { messageCount } });

    // ... your logic ...

    span.end({ output: { result: 'ok' } });
    chain.next();
    return payload;
  }
);
```

### Switching the model or manifest for one request

`payload.temporaryRequestConfig` overrides the session's LLM and manifest for the current request only; the session is not changed. Set it in BeforeGenerate middleware. Input middleware runs before `generate()` builds the request, so a value set there is lost.

```typescript
chatConstructor.registerBeforeGenerateMiddleware('route-long-questions', async (context, payload, chain) => {
  const text = payload.directMessages
    .flatMap((message) => message.content)
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join(' ');

  if (text.length > 2000) {
    // Keep the other fields, such as llmContextWindow
    payload.temporaryRequestConfig = {
      ...payload.temporaryRequestConfig,
      llmName: 'large-model',
      manifestName: 'detailed-answers'
    };
  }

  chain.next();
  return payload;
});
```

`generate()` fills `temporaryRequestConfig` from its `temporaryLlmName`, `temporaryManifestName` and `llmContextWindow` options before the BeforeGenerate middleware runs, so middleware sees those values and can change them. To change the session for later requests as well, call `await context.session.update({ currentLlmName, currentManifestName })`.

## AfterGenerate Middleware

Runs after the LLM response is received. Use it for logging, content filtering, or response transformation.

```typescript
chatConstructor.registerAfterGenerateMiddleware(
  'content-filter',
  async (context, payload, chain) => {
    // payload is a Chat.GenerateResultMessages:
    // payload.llmResponse — the UnifiedLLMResponse
    // payload.directMessages — the user's processed messages
    // payload.augmentedContext — context messages

    // Example: filter sensitive content from the response
    for (const part of payload.llmResponse.topChoice.content) {
      if (part.type === 'text') {
        part.text = redactSensitiveInfo(part.text);
      }
    }

    chain.next();
    return payload;
  }
);
```

## Middleware Registration Order

Middleware executes in the order you register it. Order matters:

```typescript
// Runs first
chatConstructor.registerInputMiddleware('step-1', middlewareA);
// Runs second
chatConstructor.registerInputMiddleware('step-2', middlewareB);
// Runs third
chatConstructor.registerInputMiddleware('step-3', middlewareC);
```

If a middleware does not call `chain.next()`, the chain stops after it, and the middleware registered after it in that stage is skipped.

## Using Context in Middleware

The `ContextInterface` provides:

```typescript
context.session              // Session object: id, currentLlmName, currentManifestName, ctx
context.chatHistory          // Chat history: messages array
context.request              // Current request: correlatorIds, messageIds, messages
context.tracer               // Tracer for observability spans
context.generate(llmName, manifestName)      // A separate LLM call with the current history
context.aiTask(llmName, taskName, content)   // Standalone LLM call (see AI Tasks guide)
context.getPrompt(promptName, llmName)       // Retrieve a computed prompt
```

Changes to `context.session` (`currentLlmName`, `currentManifestName`, `ctx`) stay in memory until you call `await context.session.update()`. With no argument it saves the in-memory values; `update({ ctx })` replaces the whole `ctx`, so spread the old one in. Inside `generate()`, an in-memory change still applies to the current request.

`chain.ctx` holds a copy of the context that `chain.updateCtx(partial)` merges into. Later middleware in the same stage can read it through `chain.ctx`; the `context` argument they receive does not change.

## Tracing in Middleware

LOFT automatically creates tracer spans for each middleware step. You can create nested spans:

```typescript
chatConstructor.registerBeforeGenerateMiddleware(
  'my-middleware',
  async (context, payload, chain) => {
    const span = context.tracer.span({
      name: 'custom-operation',
      input: { sessionId: context.session.id },
      metadata: { step: 'before-generate' }
    });

    try {
      // ... your logic ...
      span.end({ output: { success: true }, level: 'DEFAULT' });
    } catch (error) {
      span.end({ level: 'ERROR', statusMessage: String(error) });
      throw error;
    }

    chain.next();
    return payload;
  }
);
```

## See It in Action

The **[express-full](../../examples/express-full/)** example demonstrates all three middleware stages (Input, BeforeGenerate, AfterGenerate) with logging and a dynamic system message via GM Computer.

## Common Patterns

### Conditional processing

```typescript
chatConstructor.registerBeforeGenerateMiddleware(
  'premium-only',
  async (context, payload, chain) => {
    if (!context.session.ctx.isPremium) {
      chain.preventGeneration({
        content: [{ type: 'text', text: 'This feature requires a premium subscription.' }],
        role: Type.LLM.UnifiedMessageRole.assistant
      });
      return payload;
    }
    chain.next();
    return payload;
  }
);
```

### Redacting personal data

Input middleware can rewrite the user's text before it is stored or sent to the LLM. Input middleware runs on both `addMessages()` and `generate()`, so make the change safe to apply twice, as this one is. Add patterns for phone numbers, card numbers or your own ID formats the same way:

```typescript
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

chatConstructor.registerInputMiddleware('redact-emails', async (context, payload, chain) => {
  for (const message of payload.directMessages) {
    message.content = message.content.map((part) =>
      part.type === 'text' ? { ...part, text: part.text.replace(EMAIL, '[email]') } : part
    );
  }
  chain.next();
  return payload;
});
```

Redaction in middleware does not keep the original text out of traces: each middleware span records the payload it received, and the `generate()` trace records the request as it arrived. If you send traces to Langfuse, redact before calling LOFT, or leave the tracer out for that data. Log that something was redacted, not the value.

For middleware that calls an LLM to classify or route messages, see the [AI Tasks guide](./ai-tasks.md).

### Tagging messages with metadata

Every message has a `ctx` object that is stored with it. Input middleware can set it on the incoming messages, and later requests read it from the chat history:

```typescript
chatConstructor.registerInputMiddleware('tag-channel', async (context, payload, chain) => {
  for (const message of payload.directMessages) {
    message.ctx = { ...message.ctx, channel: 'web', receivedAt: new Date().toISOString() };
  }
  chain.next();
  return payload;
});

// Later, for example in BeforeGenerate middleware:
const fromWeb = context.chatHistory.messages.filter((message) => message.ctx.channel === 'web');
```

Set `ctx` on `payload.directMessages`; it is saved when the messages are stored (by `addMessages()`, or by `result.messages.save()` after `generate()`). Assigning `ctx` on a message in `context.chatHistory.messages` changes only the copy in memory. To change a stored message, see [Patching messages](./chat-persistence.md#patching-messages).

### Optional steps that must not fail the request

A step such as classification or analysis should not take the conversation down when it fails. Catch the error, log it and continue:

```typescript
import { Logger } from '@moc-global/loft-definitions';

const log = new Logger('classify-intent');

chatConstructor.registerBeforeGenerateMiddleware('classify-intent', async (context, payload, chain) => {
  try {
    const result = await context.aiTask('small-model', 'classify-intent', 'text to classify');
    const intent = result.topChoice.content.find((part) => part.type === 'text')?.text?.trim();
    await context.session.update({ ctx: { ...context.session.ctx, lastIntent: intent } });
  } catch (error) {
    log.warn('Intent classification failed; continuing without it', { error: String(error) });
  }
  chain.next();
  return payload;
});
```

### Logging

```typescript
chatConstructor.registerAfterGenerateMiddleware(
  'log-usage',
  async (context, payload, chain) => {
    console.log('LLM usage:', payload.llmResponse.usage);
    chain.next();
    return payload;
  }
);
```
