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

`thinking` takes the four types of the Messages API: `enabled` (with `budget_tokens` of at least 1024), `adaptive`, `disabled` and `between_tools`. Which types a model accepts depends on the model; Claude Sonnet 5.5 turns thinking off only with `{ "type": "between_tools" }`, and Claude Haiku 5.5 with `{ "type": "disabled" }`.

The thinking is not part of the answer, and LOFT neither returns nor saves it. When Claude thinks before calling tools, the strategy keeps the thinking blocks in memory and sends them back at the start of that assistant message for the rest of the tool loop, so the model keeps its reasoning.

Claude needs at least one message, and current Claude models a conversation that ends with the user. The strategy adds a short user turn to the request: "Start." when it has no message, and "Continue." when a Focus turn runs after the assistant's answer. It is not saved to the chat history. Without a Focus, a request that ends with an assistant message is sent as it is.

Unless you turn it off, current Claude models think before they answer, and the thinking counts against `max_tokens`. With a small limit (a few hundred tokens) the model can use all of it on thinking and return an empty answer with `usage.finishReason` set to `max_tokens`; give it several thousand.

## Configuration

The first argument of `AnthropicCallStrategy` is passed to the Anthropic client unchanged, so it takes the SDK's `ClientOptions`: `apiKey` (default: the `ANTHROPIC_API_KEY` variable), `baseURL`, `timeout`, `maxRetries` and the rest. Both strategies take an `LlmTokenRateLimiter` and an `LlmTokenizer`; the [call manager README](https://github.com/MoC-OSS/LOFT/tree/main/packages/loft-llm-call-manager#configuration) describes their settings.

`AnthropicCallStrategy` takes an optional, experimental last argument, `AnthropicStrategyOptions`:

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `streaming` | `boolean` | `true` | `false` never streams; LOFT then sends the reply text once the call returns |

## Streaming

When a chat is generated with `onEvent`, LOFT passes an event sink to the call, and `AnthropicCallStrategy` streams the request with `messages.stream` (experimental):

- The text of the answer's text blocks reaches the sink as it arrives, and the thinking as reasoning. The chat decides whether reasoning reaches its clients, and by default it does not. Thinking signatures, redacted thinking, tool calls and their input, citations and server tool blocks are never sent; they only report activity, so LOFT knows the stream is alive.
- The usage is sent twice: the input tokens when the message starts (with the first output tokens and the cache reads), and the output tokens when it ends, with the stop reason. Each count is a total for the whole message so far, so a later value replaces an earlier one; never add them up. `totalTokens` is the input and output tokens known at that point.
- `generate()` resolves with the same `Message` the request returns without streaming, so tool calls, thinking blocks with their signatures, the usage and the stop reason work unchanged. A stop on `max_tokens` is returned as it is, as without streaming.
- An error in the middle of the stream (such as an `overloaded_error` event) rejects with the SDK's error, which the call manager may retry while nothing was delivered. A stream that ends before `message_stop`, between events or inside one, rejects with the SDK's `APIConnectionError`, with the SDK's own error as its `cause`, which the call manager may retry while nothing was delivered; once `message_stop` has arrived, a connection that fails after it resolves with the message. Aborting the call's signal rejects with the SDK's `APIUserAbortError`, as without streaming, even when the last event had already arrived. The provider logs a failed streamed call with the error's class, status, `type` and `code` only: the provider's own failure log never includes the error message. The call manager and the chat still log the error as before.
- `new AnthropicCallStrategy(config, rateLimiter, tokenizer, { streaming: false })` never streams.

`generateStream` and `extractContentFromChunk` of `AnthropicCallStrategy`, and the `generateStream` method of `AnthropicLoftStrategy`, are deprecated and are removed in the next major release. Use `chat.generate({ onEvent })` instead; the [streaming guide](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/streaming.md) explains the events.

## Documentation

- [LLM strategies](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/llm-strategies.md)
- [Quickstart](https://github.com/MoC-OSS/LOFT/blob/main/docs/getting-started/quickstart.md), Anthropic variant
- [Manifests](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/manifests.md)

## License

[MIT](./LICENSE)
