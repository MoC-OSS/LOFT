import { NativeCallManagerStrategy } from '@moc-global/loft-definitions';
import {
  GeminiCallStrategy,
  GeminiLoftStrategy,
  GeminiRequest,
  GeminiResponse,
  GeminiStrategyConfig
} from '@moc-global/loft-gemini-strategy';
import { GenerateCallManager, LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';

import { env, requireKey } from './config';

export function initGeminiStrategy(modelName: string) {
  // Vertex AI authenticates through GOOGLE_APPLICATION_CREDENTIALS (Application Default Credentials)
  const geminiConfig: GeminiStrategyConfig = {
    mode: 'vertexai',
    project: requireKey('LOFT_GEMINI_VERTEX_PROJECT'),
    location: env.LOFT_GEMINI_VERTEX_LOCATION
  };

  const llmTokenRateLimiterConfig = {
    newTokensPerSecond: env.LOFT_OPENAI_CALL_STRATEGY_NEW_TOKENS_PER_SECOND,
    newRequestsPerSecond: env.LOFT_OPENAI_CALL_STRATEGY_NEW_REQUESTS_PER_SECOND,
    maxRequests: env.LOFT_OPENAI_CALL_STRATEGY_MAX_REQUESTS,
    maxTokens: env.LOFT_OPENAI_CALL_STRATEGY_MAX_TOKENS,
    maxAwaitSeconds: env.LOFT_OPENAI_CALL_STRATEGY_MAX_AWAIT_SECONDS
  };

  const geminiCallStrategy = new GeminiCallStrategy(
    geminiConfig,
    new LlmTokenRateLimiter(llmTokenRateLimiterConfig),
    new LlmTokenizer()
  );

  const geminiCallManagerService = new GenerateCallManager<GeminiRequest, GeminiResponse>(
    modelName,
    {
      highPriorityTasksLimit: env.LOFT_OPENAI_CALL_MANAGER_HIGH_PRIORITY_TASKS_LIMIT,
      retryDelay: env.LOFT_OPENAI_CALL_MANAGER_RETRY_DELAY,
      retryAttemptsLimit: env.LOFT_OPENAI_CALL_MANAGER_RETRY_ATTEMPTS_LIMIT
    },
    geminiCallStrategy
  );

  const geminiLoftStrategy = new GeminiLoftStrategy(
    { llmName: modelName },
    new NativeCallManagerStrategy(geminiCallManagerService)
  );

  return geminiLoftStrategy;
}
