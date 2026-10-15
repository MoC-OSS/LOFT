# @moc-global/loft-anthropic-strategy

The Anthropic Claude provider for [LOFT](https://github.com/MoC-OSS/LOFT). It turns LOFT's unified messages into Messages API requests, and the responses, including parallel tool calls, back into LOFT's format.

## Install

```bash
npm install @moc-global/loft-anthropic-strategy @anthropic-ai/sdk @moc-global/loft-llm-call-manager
```

`@anthropic-ai/sdk` is a peer dependency: any 0.x release from 0.39.0. Its other peers, `@moc-global/loft-definitions`, `zod` 3 and `@modelcontextprotocol/sdk`, are already in a LOFT application.

## Usage

A provider strategy has three layers: the call strategy talks to the API, a call manager from `@moc-global/loft-llm-call-manager` queues, rate-limits and retries the calls, and the LOFT strategy is what you register under an LLM name.

```typescript
import {
  AnthropicCallStrategy,
  AnthropicLoftStrategy,
  AnthropicRequest,
  AnthropicResponse
} from '@moc-global/loft-anthropic-strategy';
import { LoftConstructor } from '@moc-global/loft';
import { Chat, NativeCallManagerStrategy } from '@moc-global/loft-definitions';
import { GenerateCallManager, LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';

export async function registerClaude(loftConstructor: LoftConstructor<Chat.ChatInterface>, llmName: string) {
  const callStrategy = new AnthropicCallStrategy(
    { apiKey: process.env.ANTHROPIC_API_KEY },
    new LlmTokenRateLimiter({
      newTokensPerSecond: 50_000,
      newRequestsPerSecond: 50,
      maxTokens: 2_000_000,
      maxRequests: 500,
      maxAwaitSeconds: 300
    }),
    new LlmTokenizer()
  );
  const callManager = new GenerateCallManager<AnthropicRequest, AnthropicResponse>(
    llmName,
    { highPriorityTasksLimit: 10, retryDelay: 1000, retryAttemptsLimit: 3 },
    callStrategy
  );
  await loftConstructor.registerLlmStrategy(
    llmName,
    new AnthropicLoftStrategy({ llmName }, new NativeCallManagerStrategy(callManager))
  );
}
```

The model and its settings come from the manifest entry with the same LLM name. `max_tokens` is required:

```json
{
  "llmManifests": {
    "assistant": {
      "claude-sonnet": {
        "systemMessage": "You are a helpful assistant.",
        "modelPreset": { "model": "claude-sonnet-5-5", "max_tokens": 1024 }
      }
    }
  }
}
```

`modelPreset` takes the Messages API parameters: `model`, `max_tokens`, `stop_sequences`, `thinking`, `output_config` (`effort` and `format`), `service_tier`, `inference_geo`, `cache_control`, `tools`, `tool_choice` and `metadata`, plus `temperature`, `top_p` and `top_k` for older models; current Claude models reject those three with a 400 error. Unknown fields are rejected, and so are `workspace_id` and `user_profile_id`, which the SDK sends as headers.

`thinking` takes the four types of the Messages API: `enabled` (with `budget_tokens` of at least 1024), `adaptive`, `disabled` and `between_tools`. Which types a model accepts depends on the model; Claude Sonnet 5.5 and Haiku 5.5 turn thinking off only with `{ "type": "between_tools" }`.

Unless you turn it off, current Claude models think before they answer, and the thinking counts against `max_tokens`. With a small limit (a few hundred tokens) the model can use all of it on thinking and return an empty answer with `usage.finishReason` set to `max_tokens`; give it several thousand.

## Configuration

The first argument of `AnthropicCallStrategy` is passed to the Anthropic client unchanged, so it takes the SDK's `ClientOptions`: `apiKey` (default: the `ANTHROPIC_API_KEY` variable), `baseURL`, `timeout`, `maxRetries` and the rest. Both strategies take an `LlmTokenRateLimiter` and an `LlmTokenizer`; the [call manager README](https://github.com/MoC-OSS/LOFT/tree/main/packages/loft-llm-call-manager#configuration) describes their settings.

## Documentation

- [LLM strategies](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/llm-strategies.md)
- [Quickstart](https://github.com/MoC-OSS/LOFT/blob/main/docs/getting-started/quickstart.md), Anthropic variant
- [Manifests](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/manifests.md)

## License

[MIT](./LICENSE)
