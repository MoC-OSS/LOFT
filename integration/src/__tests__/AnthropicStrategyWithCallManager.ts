import {
  AnthropicCallStrategy,
  AnthropicLoftStrategy,
  AnthropicRequest,
  AnthropicResponse
} from '@moc-global/loft-anthropic-strategy';
import { NativeCallManagerStrategy } from '@moc-global/loft-definitions';
import { GenerateCallManager, LlmTokenizer } from '@moc-global/loft-llm-call-manager';
import { LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';

import { env, requireKey } from './config';

export function initAnthropicStrategy(modelName: string) {
  const anthropicApiKey = requireKey('LOFT_ANTHROPIC_API_KEY');

  // Define token-based rate limits for the LLM
  const llmTokenRateLimiterConfig = {
    newTokensPerSecond: env.LOFT_OPENAI_CALL_STRATEGY_NEW_TOKENS_PER_SECOND,
    newRequestsPerSecond: env.LOFT_OPENAI_CALL_STRATEGY_NEW_REQUESTS_PER_SECOND,
    maxRequests: env.LOFT_OPENAI_CALL_STRATEGY_MAX_REQUESTS,
    maxTokens: env.LOFT_OPENAI_CALL_STRATEGY_MAX_TOKENS,
    maxAwaitSeconds: env.LOFT_OPENAI_CALL_STRATEGY_MAX_AWAIT_SECONDS
  };

  // Create OpenAI call strategy with token limiter
  const anthropicCallStrategy = new AnthropicCallStrategy(
    { apiKey: anthropicApiKey },
    new LlmTokenRateLimiter(llmTokenRateLimiterConfig),
    new LlmTokenizer()
  );

  // GenerateCallManager is responsible for handling concurrency, retries, etc.
  const anthropicCallManagerService: GenerateCallManager<AnthropicRequest, AnthropicResponse> = new GenerateCallManager<
    AnthropicRequest,
    AnthropicResponse
  >(
    modelName,
    {
      highPriorityTasksLimit: env.LOFT_OPENAI_CALL_MANAGER_HIGH_PRIORITY_TASKS_LIMIT,
      retryDelay: env.LOFT_OPENAI_CALL_MANAGER_RETRY_DELAY,
      retryAttemptsLimit: env.LOFT_OPENAI_CALL_MANAGER_RETRY_ATTEMPTS_LIMIT
    },
    anthropicCallStrategy
  );

  // OpenAiLoftStrategy uses a NativeCallManagerStrategy wrapper to talk to the call manager
  const anthropicLoftStrategy = new AnthropicLoftStrategy(
    {
      llmName: modelName
    },
    new NativeCallManagerStrategy(anthropicCallManagerService)
  );

  return anthropicLoftStrategy;
}
