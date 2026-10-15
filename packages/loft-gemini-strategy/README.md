# @moc-global/loft-gemini-strategy

The Google Gemini provider for [LOFT](https://github.com/MoC-OSS/LOFT), through Vertex AI or Google AI Studio. It turns LOFT's unified messages into `@google/genai` requests, and the responses, including function calls, back into LOFT's format.

## Install

```bash
npm install @moc-global/loft-gemini-strategy @google/genai @moc-global/loft-llm-call-manager
```

`@google/genai` 2 (from 2.30.0) or 1 (from 1.30.0) is a peer dependency. Its other peers, `@moc-global/loft-definitions`, `zod` 3 and `@modelcontextprotocol/sdk`, are already in a LOFT application.

## Usage

A provider strategy has three layers: the call strategy talks to the API, a call manager from `@moc-global/loft-llm-call-manager` queues, rate-limits and retries the calls, and the LOFT strategy is what you register under an LLM name.

```typescript
import { LoftConstructor } from '@moc-global/loft';
import { Chat, NativeCallManagerStrategy } from '@moc-global/loft-definitions';
import {
  GeminiCallStrategy,
  GeminiLoftStrategy,
  GeminiRequest,
  GeminiResponse,
  GeminiStrategyConfig
} from '@moc-global/loft-gemini-strategy';
import { GenerateCallManager, LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';

// Vertex AI signs in with Application Default Credentials
const vertexAi: GeminiStrategyConfig = { mode: 'vertexai', project: 'my-gcp-project', location: 'us-central1' };
// Google AI Studio uses an API key
const aiStudio: GeminiStrategyConfig = { mode: 'apikey', apiKey: process.env.GEMINI_API_KEY! };

export async function registerGemini(loftConstructor: LoftConstructor<Chat.ChatInterface>, llmName: string) {
  const callStrategy = new GeminiCallStrategy(
    process.env.GEMINI_API_KEY ? aiStudio : vertexAi,
    new LlmTokenRateLimiter({
      newTokensPerSecond: 50_000,
      newRequestsPerSecond: 50,
      maxTokens: 2_000_000,
      maxRequests: 500,
      maxAwaitSeconds: 300
    }),
    new LlmTokenizer()
  );
  const callManager = new GenerateCallManager<GeminiRequest, GeminiResponse>(
    llmName,
    { highPriorityTasksLimit: 10, retryDelay: 1000, retryAttemptsLimit: 3 },
    callStrategy
  );
  await loftConstructor.registerLlmStrategy(
    llmName,
    new GeminiLoftStrategy({ llmName }, new NativeCallManagerStrategy(callManager))
  );
}
```

The model and its settings come from the manifest entry with the same LLM name. The fields are camelCase, as in `@google/genai`:

```json
{
  "llmManifests": {
    "assistant": {
      "gemini": {
        "systemMessage": "You are a helpful assistant.",
        "modelPreset": { "model": "gemini-2.5-flash-lite", "temperature": 0.7, "maxOutputTokens": 500 }
      }
    }
  }
}
```

`modelPreset` also takes `topP`, `topK`, `stopSequences`, `safetySettings`, `toolConfig`, `responseMimeType` and `responseSchema`.

## Configuration

| Mode | Fields | Credentials |
| --- | --- | --- |
| `vertexai` | `project`; `location`, default `us-central1` | Application Default Credentials, for example `gcloud auth application-default login` or a service account |
| `apikey` | `apiKey` | A Google AI Studio key |

Both strategies take an `LlmTokenRateLimiter` and an `LlmTokenizer`; the [call manager README](https://github.com/MoC-OSS/LOFT/tree/main/packages/loft-llm-call-manager#configuration) describes their settings.

## Documentation

- [LLM strategies](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/llm-strategies.md)
- [Manifests](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/manifests.md)

## License

[MIT](./LICENSE)
