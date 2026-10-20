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

Gemini 3 models sign their thinking and reject a request whose earlier function calls come back without their signatures. The strategy keeps each signature in the `_meta` of the content part (`geminiThoughtSignature`) and sends it back with the chat history, so a saved conversation can go on. Thought summaries are not part of the answer.

Images in a message reach the model:

- A base64 image, or a base64 `data:` URL, goes inline.
- An `https://` or `gs://` URL goes as file data, which Gemini fetches. A Cloud Storage URI and a public HTTPS URL were checked with Vertex AI. With an API key, the Gemini Developer API may take only the URIs of its Files API.
- Any other URL (`http://`, `file://`, a relative path) is left out with a warning.
- The URL must stay fetchable: the history is sent again on each turn, and Gemini rejects a request whose image it cannot download.
- The MIME type comes from the part. When the part has none, it comes from the data (PNG, JPEG, GIF, WebP, HEIC, AVIF, BMP) or the URL extension, and is JPEG, with a warning, when neither tells.
- Images inside tool results are not sent.

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
