# How to Register LLM Strategies

This guide shows how to register LLM providers (OpenAI, Anthropic, Gemini) with LOFT. Each provider requires three components: a call strategy, a call manager, and a LOFT strategy.

## Prerequisites

- LOFT core packages installed (`@moc-global/loft`, `@moc-global/loft-definitions`)
- `@moc-global/loft-llm-call-manager` installed
- Your chosen LLM provider package installed

> **Package manager:** This guide uses `npm`. Substitute `yarn add` or `pnpm add` if that's what your project uses.

## The Three-Layer Pattern

Every LLM registration follows this pattern:

```
1. CallStrategy      — makes HTTP calls to the LLM API
2. GenerateCallManager — handles rate limiting, retry, prioritization
3. LoftStrategy      — formats messages and wraps everything for LOFT
```

## OpenAI

```bash
npm install @moc-global/loft-openai-strategy openai@^4
```

```typescript
import { NativeCallManagerStrategy } from '@moc-global/loft-definitions';
import { GenerateCallManager, LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';
import {
  OpenAiCallStrategy,
  OpenAiLoftStrategy,
  OpenAiRequest,
  OpenAiResponse
} from '@moc-global/loft-openai-strategy';

function createOpenAiStrategy(modelName: string, apiKey: string) {
  // 1. Call strategy — talks to OpenAI API
  const callStrategy = new OpenAiCallStrategy(
    apiKey,
    new LlmTokenRateLimiter({
      newTokensPerSecond: 50000,
      newRequestsPerSecond: 100,
      maxRequests: 500,
      maxTokens: 2000000,
      maxAwaitSeconds: 300
    }),
    new LlmTokenizer()
  );

  // 2. Call manager — rate limiting and retry
  const callManager = new GenerateCallManager<OpenAiRequest, OpenAiResponse>(
    modelName,
    { highPriorityTasksLimit: 10, retryDelay: 1000, retryAttemptsLimit: 3 },
    callStrategy
  );

  // 3. LOFT strategy — wraps everything
  return new OpenAiLoftStrategy(
    { llmName: modelName },
    new NativeCallManagerStrategy(callManager)
  );
}

// Register with LOFT
await loftConstructor.registerLlmStrategy('gpt-4o-mini', createOpenAiStrategy('gpt-4o-mini', process.env.OPENAI_API_KEY!));
await loftConstructor.registerLlmStrategy('gpt-4o', createOpenAiStrategy('gpt-4o', process.env.OPENAI_API_KEY!));
```

### Azure OpenAI

```typescript
import { LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';
import { AzureOpenAiCallStrategy, AzureOpenAiLoftStrategy } from '@moc-global/loft-openai-strategy';

const callStrategy = new AzureOpenAiCallStrategy(
  {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,         // e.g., 'https://my-resource.openai.azure.com'
    deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT!, // e.g., 'my-gpt4-deployment'
    auth: { type: 'api-key', apiKey: process.env.AZURE_OPENAI_API_KEY! }
    // Or auth: { type: 'azure-ad' } to sign in with DefaultAzureCredential.
    // apiVersion is optional; without it a default version is used.
  },
  new LlmTokenRateLimiter({
    newTokensPerSecond: 50000,
    newRequestsPerSecond: 100,
    maxRequests: 500,
    maxTokens: 2000000,
    maxAwaitSeconds: 300
  }),
  new LlmTokenizer()
);

// The rest follows the same pattern — GenerateCallManager → AzureOpenAiLoftStrategy
```

## Anthropic

```bash
npm install @moc-global/loft-anthropic-strategy @anthropic-ai/sdk@^0.39.0
```

```typescript
import { NativeCallManagerStrategy } from '@moc-global/loft-definitions';
import { GenerateCallManager, LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';
import {
  AnthropicCallStrategy,
  AnthropicLoftStrategy,
  AnthropicRequest,
  AnthropicResponse
} from '@moc-global/loft-anthropic-strategy';

function createAnthropicStrategy(modelName: string, apiKey: string) {
  // 1. Call strategy — takes Anthropic ClientOptions object (not a plain string)
  const callStrategy = new AnthropicCallStrategy(
    { apiKey },
    new LlmTokenRateLimiter({
      newTokensPerSecond: 50000,
      newRequestsPerSecond: 100,
      maxRequests: 500,
      maxTokens: 2000000,
      maxAwaitSeconds: 300
    }),
    new LlmTokenizer()
  );

  // 2. Call manager
  const callManager = new GenerateCallManager<AnthropicRequest, AnthropicResponse>(
    modelName,
    { highPriorityTasksLimit: 10, retryDelay: 1000, retryAttemptsLimit: 3 },
    callStrategy
  );

  // 3. LOFT strategy
  return new AnthropicLoftStrategy(
    { llmName: modelName },
    new NativeCallManagerStrategy(callManager)
  );
}

await loftConstructor.registerLlmStrategy(
  'claude-sonnet',
  createAnthropicStrategy('claude-sonnet', process.env.ANTHROPIC_API_KEY!)
);
```

### Key Difference from OpenAI

`OpenAiCallStrategy` takes an API key **string** as its first argument. `AnthropicCallStrategy` takes an Anthropic `ClientOptions` **object** (e.g., `{ apiKey: '...' }`). This is because the Anthropic SDK accepts additional options like `baseURL`, `timeout`, etc.

## Gemini

```bash
npm install @moc-global/loft-gemini-strategy @google/genai
```

```typescript
import { NativeCallManagerStrategy } from '@moc-global/loft-definitions';
import { GenerateCallManager, LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';
import { GeminiCallStrategy, GeminiLoftStrategy } from '@moc-global/loft-gemini-strategy';

// Gemini follows the same three-layer pattern
// GeminiCallStrategy constructor accepts Google GenAI configuration
```

## Multiple Providers

You can register multiple strategies — even from different providers:

```typescript
await loftConstructor.registerLlmStrategy('gpt-4o-mini', createOpenAiStrategy('gpt-4o-mini', openAiKey));
await loftConstructor.registerLlmStrategy('gpt-4o', createOpenAiStrategy('gpt-4o', openAiKey));
await loftConstructor.registerLlmStrategy('claude-sonnet', createAnthropicStrategy('claude-sonnet', anthropicKey));
```

`registerLlmStrategy()` returns a promise; await it before you call `generate()`. Registrations wait for the first manifest load and are applied one at a time, so running them in parallel with `Promise.all` is safe. Registering a name that already exists is skipped with a warning unless you pass `true` as the third argument (`forceOverwrite`).

### Switching at Runtime

The strategy used for a `generate()` call is determined by the session's `currentLlmName`:

```typescript
// Create a session that uses OpenAI
const session = await loft.chat.createSession({
  currentLlmName: 'gpt-4o-mini',
  currentManifestName: 'my-assistant',
  ctx: {}
});

// Override for a single request without changing the session
const result = await loft.chat.generate({
  sessionId: session.id,
  directMessages: [...],
  temporaryLlmName: 'claude-sonnet'  // Uses Anthropic for this request only
});
```

### Overwriting Strategies

By default, registering a strategy with an existing name is a no-op (logs a warning). To replace:

```typescript
await loftConstructor.registerLlmStrategy('gpt-4o-mini', newStrategy, true); // forceOverwrite = true
```

## Manifest Configuration

Each registered LLM name must have a corresponding entry in your manifest JSON:

```json
{
  "llmManifests": {
    "my-assistant": {
      "gpt-4o-mini": {
        "systemMessage": "You are a helpful assistant.",
        "modelPreset": { "model": "gpt-4o-mini", "temperature": 0.7, "max_tokens": 1000 }
      },
      "claude-sonnet": {
        "systemMessage": "You are a helpful assistant.",
        "modelPreset": { "model": "claude-sonnet-5-5", "max_tokens": 1000 }
      }
    }
  }
}
```

The `modelPreset` is validated at registration time against the strategy's Zod schema (via `generateModelPresetSchema()`). Invalid presets will throw.

## See It in Action

The example applications demonstrate LLM strategy registration in complete, runnable projects:

- **[express-basic](../../examples/express-basic/)** — OpenAI strategy with `gpt-4o-mini`
- **[express-full](../../examples/express-full/)** — Anthropic strategy with `claude-sonnet-5-5`
- **[nestjs](../../examples/nestjs/)** — OpenAI strategy inside a NestJS module
- **[serverless](../../examples/serverless/)** — OpenAI strategy in an AWS Lambda handler

## Rate Limiter Configuration

The `LlmTokenRateLimiter` config controls throughput:

| Parameter | Type | Description |
|-----------|------|-------------|
| `newTokensPerSecond` | number | Max tokens per second |
| `newRequestsPerSecond` | number | Max requests per second |
| `maxRequests` | number | Max concurrent requests |
| `maxTokens` | number | Max total token budget |
| `maxAwaitSeconds` | number | Max wait time for a rate-limited request |

The `GenerateCallManager` config controls retries:

| Parameter | Type | Description |
|-----------|------|-------------|
| `highPriorityTasksLimit` | number | Max high-priority tasks in queue before rejection |
| `retryDelay` | number | Delay between retries (ms) |
| `retryAttemptsLimit` | number | Max retry attempts before failure |
