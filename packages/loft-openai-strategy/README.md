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

`OpenAiCallStrategy` takes the API key as its first argument. Both take an `LlmTokenRateLimiter` and an `LlmTokenizer`; the [call manager README](https://github.com/MoC-OSS/LOFT/tree/main/packages/loft-llm-call-manager#configuration) describes their settings.

## Documentation

- [LLM strategies](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/llm-strategies.md)
- [Quickstart](https://github.com/MoC-OSS/LOFT/blob/main/docs/getting-started/quickstart.md)
- [Manifests](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/manifests.md)

## License

[MIT](./LICENSE)
