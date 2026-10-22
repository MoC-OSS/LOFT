# @moc-global/loft-llm-call-manager

Rate limits, retries and a call queue for the LLM calls of [LOFT](https://github.com/MoC-OSS/LOFT). Each provider strategy sends its calls through a `GenerateCallManager`, which by default runs them one at a time per model (`concurrency` raises that), waits while the model's token or request budget is spent, and retries failed calls.

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
| `retryAttemptsLimit` | Attempts per call, the first included. `3` means up to two retries. Only 408, 429 and 5xx responses, network failures, and provider errors of type `overloaded_error`, `api_error` or `server_error` that arrive without a status (as inside a stream) are retried; a cancelled call, a 400, 401 or 404 and any other error are not. |
| `retryDelay` | Base of the backoff, in milliseconds: the wait doubles with each retry, between half and all of it at random, at most 60 s. A `Retry-After` header from the provider sets the wait instead. |
| `concurrency` | Optional. How many calls of the model run at the same time. An integer of at least 1, or the constructor throws a `RangeError`. Default: `1`. |
| `reserveTokens` | Optional. Takes the estimated tokens from the budget before the call and settles to the provider's count after it, so calls running at the same time cannot overspend the budget. `false` charges the provider's count after a successful call only, as before. A subclass that overrides `makeGenerateRequest(req, options?, reservation?)` must pass the third argument on to `super`, or the manager must use `reserveTokens: false`. Default: `true`. |
| `streamIdleTimeoutMs` | Optional, experimental, streamed calls only. How long an attempt may stay silent between two provider events, in milliseconds, before it is aborted with `StreamIdleTimeoutError`. It starts at the provider's first output (text, reasoning or other activity; a usage report does not start it), and after that every provider event restarts it. The wait before the first output, such as a model thinking without sending its thoughts, is bounded by `streamFirstEventTimeoutMs` instead. `0` disables it. An integer from 0 to 2147483647, or the constructor throws a `RangeError`. Default: `60000`. |
| `streamFirstEventTimeoutMs` | Optional, experimental, streamed calls only. How long an attempt may wait for the provider's first output (text, reasoning or other activity; a usage report does not end the wait), in milliseconds, before it is aborted with `StreamIdleTimeoutError`. A running stream is bounded only by this timeout until its first output, then by `streamIdleTimeoutMs`, and by the caller's signal: the SDKs' request timeout covers only the wait for the response headers. It also bounds calls the provider answers without streaming (a provider that ignores `onEvent`, a strategy built with `streaming: false`, or a request it does not stream, such as one with a JSON schema or strict tools), so keep it above your longest non-streamed response and your longest silent reasoning. `0` turns it off. An integer from 0 to 2147483647, or the constructor throws a `RangeError`. Default: `600000` (10 minutes, the SDKs' request timeout). |

`LlmTokenRateLimiter` keeps two budgets that refill over time: tokens and requests. Before each call it estimates the request's tokens, waits until both budgets allow the call and takes the tokens and a request from them in one step. If the waits add up to more than `maxAwaitSeconds`, the call fails with `LlmCallManagerLongAwaitError`. After the call it corrects the estimate to the tokens the provider reports. A call that fails before the provider sent anything gives its tokens back but not its request; a call cancelled after it took them keeps both, and so does a streamed call that fails after the provider's first event. A call cancelled while it waits for the budget stops waiting at once and takes nothing. Set the budgets a little below your provider's rate limits.

| Field | What it does |
| --- | --- |
| `maxTokens`, `newTokensPerSecond` | Size of the token budget, and how many tokens it regains per second |
| `maxRequests`, `newRequestsPerSecond` | Size of the request budget, and how many requests it regains per second |
| `maxAwaitSeconds` | The longest a call may wait for budget |

`LlmTokenizer` estimates tokens with the `gpt-3.5-turbo` encoding of tiktoken plus 10%, for every provider.

`GenerateWithQueueManager` serves the queued mode, which is not available through LOFT's public API yet, and `GenerateWithStreamManager` the old streaming mode. `GenerateWithQueueManager` takes `concurrency`, `reserveTokens` and the two stream timeouts like `GenerateCallManager`. `GenerateWithStreamManager` is deprecated: use `chat.generate({ onEvent })` instead. It does not reserve tokens and charges the provider's count after a successful call. A queued task that waits too long for the rate limiter goes back to the incoming queue up to `maxRequeueAttempts` times (default 10); then it goes to the optional dead-letter queue (the sixth constructor argument) with its error, or to the outgoing queue as `{ sessionId, llmName, callContext, priority, error: { name, message } }`.

### Streaming

Streaming is experimental. When the call options carry an `onEvent` sink, as LOFT passes for `chat.generate({ onEvent })`, the call manager streams the call. Each attempt sends `{ type: 'request-start' }` to the sink right before the provider call, and the provider gets a wrapped sink and a signal that also aborts on the timeouts above. The provider's events go through to the sink, which returns `true` for an event that reached the consumer. Once one did, the call is not retried, because a new attempt would repeat that output; while nothing was delivered, failed attempts and timeouts are retried as usual. A timeout rejects with `StreamIdleTimeoutError` from `@moc-global/loft-definitions`, unless the caller aborted, which wins. The timeout, or the caller's abort, ends the attempt even when the provider ignores the abort, so it does not hold its queue slot; whatever the provider returns or throws after that is dropped. A provider that ignores the caller's abort ends with the signal's `reason`. Events the provider sends after an attempt was aborted are not passed on. A sink that throws counts as not delivered and does not stop the stream. Without `onEvent` none of this applies.

## Documentation

- [LLM strategies](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/llm-strategies.md)
- [Strategy pattern](https://github.com/MoC-OSS/LOFT/blob/main/docs/concepts/strategy-pattern.md)
- [Error handling](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/error-handling.md)

## License

[MIT](./LICENSE)
