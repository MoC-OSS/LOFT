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

`modelPreset` also takes `topP`, `topK`, `stopSequences`, `candidateCount`, `presencePenalty`, `frequencyPenalty`, `responseLogprobs`, `logprobs`, `seed`, `safetySettings`, `toolConfig`, `thinkingConfig` (`thinkingBudget`, `includeThoughts`, `thinkingLevel`), `responseMimeType` and `responseSchema`, and the strategy sends each one it has in the request config:

- The snake_case spellings `max_output_tokens`, `top_p`, `top_k`, `stop_sequences` and `candidate_count` are accepted as aliases; when a preset has both spellings, the camelCase key wins. Other keys, and other snake_case spellings, are ignored.
- `responseMimeType: "application/json"` with a `responseSchema` gives structured output, and the reply streams like any other text. `responseSchema` is Gemini's schema format, a subset of OpenAPI 3.0 with Gemini's types (`"OBJECT"`, `"STRING"`…), not JSON Schema: keywords such as `additionalProperties` are not accepted. Some models may reject JSON mode together with tools.
- A request with a `candidateCount` above 1 is answered without streaming, because Vertex AI rejects it streamed.

MCP and additional tools are declared to Gemini from their JSON Schema. A list of types such as `["string", "null"]`, `anyOf` and `oneOf` become Gemini's `anyOf` and `nullable`, and `nullable: true` is kept. The constraints Gemini's schema has (`minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `pattern`, `format`), `default` and `title` are kept, and enum values are sent as strings; other keywords, such as `additionalProperties` and `const`, are left out.

When Gemini gives a function call an id, the tool call keeps it as its `callId`, and the strategy sends it back on the call and on its response, so Gemini can match them. A call without one gets a LOFT id, `<tool name>:::<random>`, which is never sent to Gemini. The strategy marks a Gemini id in the `_meta` of the tool call (`geminiFunctionCallId`), so an id from another provider in the same history is not sent either. Each function response is named after its call.

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

## Streaming

When a chat is generated with `onEvent`, LOFT passes an event sink to the call, and `GeminiCallStrategy` streams the request with `generateContentStream` (experimental):

- The text of the first candidate reaches the sink as it arrives, and its thought summaries (with `includeThoughts`) as reasoning. Function calls, code, inline data, thought signatures and the parts of other candidates are never sent; they only report activity, so LOFT knows the stream is alive. Gemini sends the usage on many chunks as a running total, so each `usage` event replaces the one before; do not add them up.
- `generate()` resolves with the same `GenerateContentResponse` the request returns without streaming: the parts are merged per candidate, each thought signature stays with its part, and the `text` and `functionCalls` getters work.
- A finish on `SAFETY` and a blocked prompt are returned like any other reply, so check the finish reason and `promptFeedback`. When a filter blocks the reply (`SAFETY`, `RECITATION`, `SPII`, `PROHIBITED_CONTENT`), the candidate has no content, as without streaming; the text deltas sent before the block cannot be taken back, and the chat's `finish` event carries the empty text with `textReplaced`. An error in the middle of the stream rejects with the SDK's error. Aborting the call's signal rejects with an `AbortError`, as without streaming. A stream that ends before every candidate finished, between events or inside one, without a blocked prompt, rejects with the SDK's `ApiError` with status 502 (the SDK's own error, if any, as its `cause`), which the call manager may retry; once every candidate has finished, a stream cut short resolves with what arrived.
- A request with a `candidateCount` above 1 is not streamed, because Vertex AI rejects it; LOFT sends the reply text once the call returns.
- `new GeminiCallStrategy(config, rateLimiter, tokenizer, { streaming: false })` never streams; LOFT then sends the reply text once the call returns.

`GeminiStream`, `generateStream` and `extractContentFromChunk` of `GeminiCallStrategy`, and the `generateStream` method of `GeminiLoftStrategy`, are deprecated and are removed in the next major release. Use `chat.generate({ onEvent })` instead; the [streaming guide](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/streaming.md) explains the events.

## Documentation

- [LLM strategies](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/llm-strategies.md)
- [Manifests](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/manifests.md)

## License

[MIT](./LICENSE)
