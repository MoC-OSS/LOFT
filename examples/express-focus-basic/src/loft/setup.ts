import {
  ChatConstructor,
  FsRepositoryConstructor,
  LOFT,
  LoftConstructor,
  ManifestManagerConstructor
} from '@moc-global/loft';
import {
  AnthropicCallStrategy,
  AnthropicLoftStrategy,
  AnthropicRequest,
  AnthropicResponse
} from '@moc-global/loft-anthropic-strategy';
import {
  ChatHistoryPostgresDialect,
  ChatHistoryRepositoryConstructor
} from '@moc-global/loft-chat-history-pg-repository';
import { Chat, Interface, NativeCallManagerStrategy } from '@moc-global/loft-definitions';
import { GenerateCallManager, LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';
import { SessionPostgresDialect, SessionRepositoryConstructor } from '@moc-global/loft-session-pg-repository';
import { Pool } from 'pg';

import { env } from '../config';
import { FOCUS_NAME, pizzaOrderFocus } from './focus-config';

export const MODEL_NAME = 'claude-sonnet-5-5';

function createAnthropicStrategy(modelName: string) {
  // Rate limiter — tune these values for your production workload
  const callStrategy = new AnthropicCallStrategy(
    { apiKey: env.ANTHROPIC_API_KEY },
    new LlmTokenRateLimiter({
      newTokensPerSecond: 50000,
      newRequestsPerSecond: 100,
      maxRequests: 500,
      maxTokens: 2000000,
      maxAwaitSeconds: 300
    }),
    new LlmTokenizer()
  );

  const callManager = new GenerateCallManager<AnthropicRequest, AnthropicResponse>(
    modelName,
    { highPriorityTasksLimit: 10, retryDelay: 1000, retryAttemptsLimit: 3 },
    callStrategy
  );

  return new AnthropicLoftStrategy({ llmName: modelName }, new NativeCallManagerStrategy(callManager));
}

export interface LoftSetup {
  loft: LOFT<Chat.ChatInterface>;
  loftConstructor: { gracefulShutdown: () => Promise<void> };
  chat: Chat.ChatInterface;
}

export async function initializeLoft(pool: Pool): Promise<LoftSetup> {
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

  await loftConstructor.registerLlmStrategy(MODEL_NAME, createAnthropicStrategy(MODEL_NAME));

  const loft = loftConstructor.getInstance() as LOFT<Chat.ChatInterface>;
  const chat = loft.chat as Chat.ChatInterface;

  loft.registerFocus(FOCUS_NAME, pizzaOrderFocus);

  return { loft, loftConstructor, chat };
}
