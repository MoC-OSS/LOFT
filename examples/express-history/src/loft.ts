import {
  ChatConstructor,
  FsRepositoryConstructor,
  LoftConstructor,
  ManifestManagerConstructor
} from '@moc-global/loft';
import {
  ChatHistoryPostgresDialect,
  ChatHistoryRepositoryConstructor
} from '@moc-global/loft-chat-history-pg-repository';
import { Interface, NativeCallManagerStrategy } from '@moc-global/loft-definitions';
import { GenerateCallManager, LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';
import {
  OpenAiCallStrategy,
  OpenAiLoftStrategy,
  OpenAiRequest,
  OpenAiResponse
} from '@moc-global/loft-openai-strategy';
import { SessionPostgresDialect, SessionRepositoryConstructor } from '@moc-global/loft-session-pg-repository';
import { Pool } from 'pg';

import { env } from './config';

function createOpenAiStrategy(modelName: string) {
  const callStrategy = new OpenAiCallStrategy(
    env.OPENAI_API_KEY,
    new LlmTokenRateLimiter({
      newTokensPerSecond: 50000,
      newRequestsPerSecond: 100,
      maxRequests: 500,
      maxTokens: 2000000,
      maxAwaitSeconds: 300
    }),
    new LlmTokenizer()
  );

  const callManager = new GenerateCallManager<OpenAiRequest, OpenAiResponse>(
    modelName,
    { highPriorityTasksLimit: 10, retryDelay: 1000, retryAttemptsLimit: 3 },
    callStrategy
  );

  return new OpenAiLoftStrategy({ llmName: modelName }, new NativeCallManagerStrategy(callManager));
}

export async function initializeLoft(pool: Pool) {
  const sessionRepositoryConstructor = new SessionRepositoryConstructor(new SessionPostgresDialect({ pool }), {
    schema: env.LOFT_SESSION_SCHEMA
  });

  const chatHistoryRepositoryConstructor = new ChatHistoryRepositoryConstructor(
    new ChatHistoryPostgresDialect({ pool }),
    { schema: env.LOFT_CHAT_HISTORY_SCHEMA }
  );

  const chatConstructor = new ChatConstructor(sessionRepositoryConstructor, chatHistoryRepositoryConstructor);

  const manifestRepository = new FsRepositoryConstructor();
  const manifestManagerConstructor = new ManifestManagerConstructor(manifestRepository, {
    manifestPath: env.LOFT_MANIFEST_PATH,
    errorPath: env.LOFT_MANIFEST_ERROR_PATH,
    cacheExpirationTime: env.LOFT_MANIFEST_CACHE_EXPIRATION
  });

  const loftConstructor = new LoftConstructor(
    { logLevel: Interface.LogLevel[env.LOFT_LOG_LEVEL as keyof typeof Interface.LogLevel] },
    manifestManagerConstructor,
    chatConstructor
  );

  await loftConstructor.registerLlmStrategy('gpt-4o-mini', createOpenAiStrategy('gpt-4o-mini'));

  const loft = loftConstructor.getInstance();
  return { loft, loftConstructor };
}
