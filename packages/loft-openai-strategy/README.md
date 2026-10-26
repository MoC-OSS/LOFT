# @moc-global/loft-openai-strategy

The OpenAI and Azure OpenAI provider for [LOFT](https://github.com/MoC-OSS/LOFT). It turns LOFT's unified messages into Chat Completions requests, and the responses, including tool calls, back into LOFT's format.

## Install

```bash
npm install @moc-global/loft-openai-strategy openai@^7 @moc-global/loft-llm-call-manager
```

`openai` 7 (from 7.34.0) or 4 (from 4.91.1) is a peer dependency; openai 5 and 6 are not tested, so the range leaves them out. Its other peers, `@moc-global/loft-definitions`, `zod` 3 and `@modelcontextprotocol/sdk`, are already in a LOFT application.

## Usage

A provider strategy has three layers: the call strategy talks to the API, a call manager from `@moc-global/loft-llm-call-manager` queues, rate-limits and retries the calls, and the LOFT strategy is what you register under an LLM name.

```typescript
import { LoftConstructor } from '@moc-global/loft';
import { Chat, NativeCallManagerStrategy } from '@moc-global/loft-definitions';
import { GenerateCallManager, LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';
import {
  OpenAiCallStrategy,
  OpenAiLoftStrategy,
  OpenAiRequest,
  OpenAiResponse
} from '@moc-global/loft-openai-strategy';

export async function registerOpenAi(loftConstructor: LoftConstructor<Chat.ChatInterface>, llmName: string) {
  const callStrategy = new OpenAiCallStrategy(
    process.env.OPENAI_API_KEY!,
    new LlmTokenRateLimiter({
      newTokensPerSecond: 50_000,
      newRequestsPerSecond: 100,
      maxTokens: 2_000_000,
      maxRequests: 500,
      maxAwaitSeconds: 300
    }),
    new LlmTokenizer()
  );
  const callManager = new GenerateCallManager<OpenAiRequest, OpenAiResponse>(
    llmName,
    { highPriorityTasksLimit: 10, retryDelay: 1000, retryAttemptsLimit: 3 },
    callStrategy
  );
  await loftConstructor.registerLlmStrategy(
    llmName,
    new OpenAiLoftStrategy({ llmName }, new NativeCallManagerStrategy(callManager))
  );
}
```

The model and its settings come from the manifest entry with the same LLM name:

```json
{
  "llmManifests": {
    "assistant": {
      "gpt-4o-mini": {
        "systemMessage": "You are a helpful assistant.",
        "modelPreset": { "model": "gpt-4o-mini", "temperature": 0.7, "max_tokens": 500 }
      }
    }
  }
}
```

`modelPreset` takes the Chat Completions parameters, such as `model`, `temperature`, `max_tokens` or `max_completion_tokens`, `reasoning_effort` and `response_format`.

### Azure OpenAI

Use `AzureOpenAiCallStrategy` and `AzureOpenAiLoftStrategy` in place of the OpenAI classes:

```typescript
import { LoftConstructor } from '@moc-global/loft';
import { Chat, NativeCallManagerStrategy } from '@moc-global/loft-definitions';
import { GenerateCallManager, LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';
import {
  AzureOpenAiCallStrategy,
  AzureOpenAiLoftStrategy,
  OpenAiRequest,
  OpenAiResponse
} from '@moc-global/loft-openai-strategy';

export async function registerAzureOpenAi(loftConstructor: LoftConstructor<Chat.ChatInterface>, llmName: string) {
  const callStrategy = new AzureOpenAiCallStrategy(
    {
      endpoint: 'https://my-resource.openai.azure.com',
      deploymentName: 'gpt-4o-mini',
      auth: { type: 'api-key', apiKey: process.env.AZURE_OPENAI_API_KEY! }
    },
    new LlmTokenRateLimiter({
      newTokensPerSecond: 50_000,
      newRequestsPerSecond: 100,
      maxTokens: 2_000_000,
      maxRequests: 500,
      maxAwaitSeconds: 300
    }),
    new LlmTokenizer()
  );
  const callManager = new GenerateCallManager<OpenAiRequest, OpenAiResponse>(
    llmName,
    { highPriorityTasksLimit: 10, retryDelay: 1000, retryAttemptsLimit: 3 },
    callStrategy
  );
  await loftConstructor.registerLlmStrategy(
    llmName,
    new AzureOpenAiLoftStrategy({ llmName }, new NativeCallManagerStrategy(callManager))
  );
}
```

## Configuration

`AzureOpenAiCallStrategy` takes:

| Field | Type | Default |
| --- | --- | --- |
| `endpoint` | `string` | The `AZURE_OPENAI_ENDPOINT` variable; the SDK throws when neither is set |
| `deploymentName` | `string` | None: the deployment comes from the request's `model` |
| `apiVersion` | `string` | `2024-10-01-preview` with a deployment name, else `2024-10-21` |
| `auth` | `{ type: 'api-key', apiKey }` or `{ type: 'azure-ad', scope? }` | Required. `azure-ad` signs in with `DefaultAzureCredential` from `@azure/identity`; the default scope is `https://cognitiveservices.azure.com/.default` |

`OpenAiCallStrategy` takes the API key as its first argument. Both take an `LlmTokenRateLimiter` and an `LlmTokenizer`; the [call manager README](https://github.com/MoC-OSS/LOFT/tree/main/packages/loft-llm-call-manager#configuration) describes their settings. Both also take an optional last argument, `OpenAiStrategyOptions` (experimental):

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `streaming` | `boolean` | `true` | `false` never streams; LOFT then sends the reply text once the call returns |
| `streamUsage` | `boolean` | `true` | Asks the API to send the usage at the end of a stream (`stream_options.include_usage`). With `false` the usage of a streamed call is unknown, and token accounting falls back to 500 tokens |
| `clientOptions` | `{ timeout?: number; maxRetries?: number }` | The SDK defaults (10 minutes, 2 retries) | Passed to the `OpenAI` or `AzureOpenAI` client |

```typescript
import { LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';
import { OpenAiCallStrategy } from '@moc-global/loft-openai-strategy';

const callStrategy = new OpenAiCallStrategy(
  process.env.OPENAI_API_KEY!,
  new LlmTokenRateLimiter({
    newTokensPerSecond: 50_000,
    newRequestsPerSecond: 100,
    maxTokens: 2_000_000,
    maxRequests: 500,
    maxAwaitSeconds: 300
  }),
  new LlmTokenizer(),
  { streamUsage: true, clientOptions: { timeout: 60_000, maxRetries: 0 } }
);
```

## Streaming

When a chat is generated with `onEvent`, LOFT passes an event sink to the call, and both call strategies stream the request (experimental):

- The request goes out with `stream: true`, and with `stream_options.include_usage` unless `streamUsage` is `false`.
- The text and refusal of the first choice reach the sink as they arrive. Tool-call arguments and the text of other choices are never sent; their chunks only report activity, so LOFT knows the stream is alive. The usage arrives at the end.
- `generate()` resolves with the same `ChatCompletion` the request returns without streaming: the chunks are merged per choice, tool calls by their index, and provider fields such as Azure's `prompt_filter_results` and `content_filter_results` are kept.
- A finish on the content filter is returned like every other finish, so check the finish reason. An error in the middle of the stream rejects with the SDK's error, as a failed request would. Aborting the call's signal rejects with the SDK's `APIUserAbortError`, as without streaming.
- Requests with a `json_schema` response format or a `strict` tool are not streamed, because the SDK can return a different result for them. They take the usual path, and LOFT sends the reply text once the call returns. `streaming: false` does the same for every request.
- A stream that ends before every choice finished, between events or inside one, rejects with the SDK's `APIConnectionError` (when it ends inside an event, with the SDK's parse error as its `cause`), which the call manager may retry while nothing was delivered. Once every choice has finished, a stream cut short (in the `[DONE]` line or before the usage chunk) resolves with what arrived; without its usage, token accounting falls back to 500 tokens. The provider logs a failed streamed call with the error's class, status, `type` and `code` only: the provider's own failure log never includes the error message. The call manager and the chat still log the error as before.

`generateStream` and `extractContentFromChunk` of both call strategies, and the `generateStream` method of `OpenAiLoftStrategy` and `AzureOpenAiLoftStrategy` are deprecated and are removed in the next major release. Use `chat.generate({ onEvent })` instead; the [streaming guide](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/streaming.md) explains the events.

## Documentation

- [LLM strategies](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/llm-strategies.md)
- [Quickstart](https://github.com/MoC-OSS/LOFT/blob/main/docs/getting-started/quickstart.md)
- [Manifests](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/manifests.md)

## License

[MIT](./LICENSE)
