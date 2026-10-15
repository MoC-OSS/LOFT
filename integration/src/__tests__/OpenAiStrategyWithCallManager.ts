import { NativeCallManagerStrategy } from '@moc-global/loft-definitions';
import { GenerateCallManager, LlmTokenizer } from '@moc-global/loft-llm-call-manager';
import { LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';
import {
  OpenAiCallStrategy,
  OpenAiLoftStrategy,
  OpenAiRequest,
  OpenAiResponse
} from '@moc-global/loft-openai-strategy';

import { env, requireKey } from './config';

export function initOpenAiStrategy(modelName: string) {
  const openAiApiKey = requireKey('LOFT_OPENAI_API_KEY');

  // Define token-based rate limits for the LLM
  const llmTokenRateLimiterConfig = {
    newTokensPerSecond: env.LOFT_OPENAI_CALL_STRATEGY_NEW_TOKENS_PER_SECOND,
    newRequestsPerSecond: env.LOFT_OPENAI_CALL_STRATEGY_NEW_REQUESTS_PER_SECOND,
    maxRequests: env.LOFT_OPENAI_CALL_STRATEGY_MAX_REQUESTS,
    maxTokens: env.LOFT_OPENAI_CALL_STRATEGY_MAX_TOKENS,
    maxAwaitSeconds: env.LOFT_OPENAI_CALL_STRATEGY_MAX_AWAIT_SECONDS
  };

  // Create OpenAI call strategy with token limiter
  const openAiCallStrategy = new OpenAiCallStrategy(
    openAiApiKey,
    new LlmTokenRateLimiter(llmTokenRateLimiterConfig),
    new LlmTokenizer()
  );

  // GenerateCallManager is responsible for handling concurrency, retries, etc.
  const openAiCallManagerService: GenerateCallManager<OpenAiRequest, OpenAiResponse> = new GenerateCallManager<
    OpenAiRequest,
    OpenAiResponse
  >(
    modelName,
    {
      highPriorityTasksLimit: env.LOFT_OPENAI_CALL_MANAGER_HIGH_PRIORITY_TASKS_LIMIT,
      retryDelay: env.LOFT_OPENAI_CALL_MANAGER_RETRY_DELAY,
      retryAttemptsLimit: env.LOFT_OPENAI_CALL_MANAGER_RETRY_ATTEMPTS_LIMIT
    },
    openAiCallStrategy
  );

  // OpenAiLoftStrategy uses a NativeCallManagerStrategy wrapper to talk to the call manager
  const openAiLoftStrategy = new OpenAiLoftStrategy(
    {
      llmName: modelName
    },
    new NativeCallManagerStrategy(openAiCallManagerService)
  );

  return openAiLoftStrategy;
}
