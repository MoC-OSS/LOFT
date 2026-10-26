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
import { Chat, Interface, NativeCallManagerStrategy, Strategy } from '@moc-global/loft-definitions';
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

/** The model the manifest configures, and the name its strategy is registered under */
export const LLM_NAME = 'gpt-4o-mini';
/** The manifest entry with the order assistant's system prompt */
export const MANIFEST_NAME = 'order-assistant';

function createOpenAiStrategy(modelName: string) {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required: copy .env.example to .env and set it');
  }

  const callStrategy = new OpenAiCallStrategy(
    env.OPENAI_API_KEY,
    new LlmTokenRateLimiter({
      newTokensPerSecond: 50000,
      newRequestsPerSecond: 100,
      maxRequests: 500,
      maxTokens: 2000000,
      maxAwaitSeconds: 300
    }),
    new LlmTokenizer(),
    // The call manager retries, so the SDK must not retry as well
    { clientOptions: { maxRetries: 0 } }
  );

  const callManager = new GenerateCallManager<OpenAiRequest, OpenAiResponse>(
    modelName,
    {
      highPriorityTasksLimit: 10,
      retryDelay: 1000,
      retryAttemptsLimit: 3,
      // Two chats can stream at the same time; with the default of 1 a second chat waits for the first to finish
      concurrency: 2,
      // A stream that stays silent this long between two chunks is aborted (and retried while nothing was sent)
      streamIdleTimeoutMs: 30000
    },
    callStrategy
  );

  return new OpenAiLoftStrategy({ llmName: modelName }, new NativeCallManagerStrategy(callManager));
}

/**
 * Builds LOFT on the given pool. Without `llm` the model is OpenAI's; the tests pass a scripted model instead.
 */
export async function initializeLoft<TRequest, TResponse>(pool: Pool, llm?: Strategy.LLM.LoftLLM<TRequest, TResponse>) {
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

  const loftConstructor = new LoftConstructor<Chat.ChatInterface>(
    { logLevel: Interface.LogLevel[env.LOFT_LOG_LEVEL as keyof typeof Interface.LogLevel] },
    manifestManagerConstructor,
    chatConstructor
  );

  if (llm) {
    await loftConstructor.registerLlmStrategy(LLM_NAME, llm);
  } else {
    await loftConstructor.registerLlmStrategy(LLM_NAME, createOpenAiStrategy(LLM_NAME));
  }

  const loft = loftConstructor.getInstance();
  return { loft, loftConstructor };
}
