# @moc-global/loft-llm-call-manager

Rate limits, retries and a call queue for the LLM calls of [LOFT](https://github.com/MoC-OSS/LOFT). Each provider strategy sends its calls through a `GenerateCallManager`, which runs them one at a time per model, waits while the model's token or request budget is spent, and retries failed calls.

## Install

```bash
npm install @moc-global/loft-llm-call-manager
```

Its peer dependency, `@moc-global/loft-definitions`, is already in a LOFT application.

## Usage

Create one call manager per registered model. It wraps the provider's call strategy, which takes a rate limiter and a tokenizer, and goes into the LOFT strategy through `NativeCallManagerStrategy`:

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

export async function registerOpenAi(loftConstructor: LoftConstructor<Chat.ChatInterface>) {
  const rateLimiter = new LlmTokenRateLimiter({
    newTokensPerSecond: 50_000, // refill rate of the token budget
    maxTokens: 2_000_000, // size of the token budget
    newRequestsPerSecond: 100, // refill rate of the request budget
    maxRequests: 500, // size of the request budget
    maxAwaitSeconds: 300 // fail a call that would wait longer than this
  });
  const callManager = new GenerateCallManager<OpenAiRequest, OpenAiResponse>(
    'gpt-4o-mini',
    { highPriorityTasksLimit: 10, retryDelay: 1000, retryAttemptsLimit: 3 },
    new OpenAiCallStrategy(process.env.OPENAI_API_KEY!, rateLimiter, new LlmTokenizer())
  );
  await loftConstructor.registerLlmStrategy(
    'gpt-4o-mini',
    new OpenAiLoftStrategy({ llmName: 'gpt-4o-mini' }, new NativeCallManagerStrategy(callManager))
  );
}
```

`loft.shutdown()` stops the rate limiter's refill timer.

## Configuration

`GenerateCallManager(name, config, callStrategy)` takes:

| Field | What it does |
| --- | --- |
| `highPriorityTasksLimit` | The most calls that may wait in the queue. One more throws `TooManyHighPriorityTasksError`. |
| `retryAttemptsLimit` | Attempts per call, the first included. `3` means up to two retries. A cancelled call is not retried. |
| `retryDelay` | Milliseconds between attempts |

`LlmTokenRateLimiter` keeps two budgets that refill over time: tokens and requests. Before each call it estimates the request's tokens and waits until both budgets allow the call. If the wait would be longer than `maxAwaitSeconds`, the call fails with `LlmCallManagerLongAwaitError`. After the call it subtracts the tokens the provider reports. Set the budgets a little below your provider's rate limits.

| Field | What it does |
| --- | --- |
| `maxTokens`, `newTokensPerSecond` | Size of the token budget, and how many tokens it regains per second |
| `maxRequests`, `newRequestsPerSecond` | Size of the request budget, and how many requests it regains per second |
| `maxAwaitSeconds` | The longest a call may wait for budget |

`LlmTokenizer` estimates tokens with the `gpt-3.5-turbo` encoding of tiktoken plus 10%, for every provider.

`GenerateWithQueueManager` and `GenerateWithStreamManager` serve the queued and streaming modes, which are not available through LOFT's public API yet.

## Documentation

- [LLM strategies](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/llm-strategies.md)
- [Strategy pattern](https://github.com/MoC-OSS/LOFT/blob/main/docs/concepts/strategy-pattern.md)
- [Error handling](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/error-handling.md)

## License

[MIT](./LICENSE)
