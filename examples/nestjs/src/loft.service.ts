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
import { Chat, Interface, NativeCallManagerStrategy, Type } from '@moc-global/loft-definitions';
import { GenerateCallManager, LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';
import {
  OpenAiCallStrategy,
  OpenAiLoftStrategy,
  OpenAiRequest,
  OpenAiResponse
} from '@moc-global/loft-openai-strategy';
import { SessionPostgresDialect, SessionRepositoryConstructor } from '@moc-global/loft-session-pg-repository';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import crypto from 'crypto';

import { env } from './config';
import { Database, initializeDatabase } from './database';

const MODEL_NAME = 'gpt-4o-mini';
const MANIFEST_NAME = 'my-assistant';

@Injectable()
export class LoftService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LoftService.name);
  private loftConstructor: LoftConstructor<Chat.ChatInterface> | null = null;
  private chat: Chat.ChatInterface | null = null;
  private db: Database | null = null;

  async onModuleInit(): Promise<void> {
    await this.initialize();
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  private getChat(): Chat.ChatInterface {
    if (!this.chat) {
      throw new Error('LoftService has not been initialized');
    }
    return this.chat;
  }

  async initialize(): Promise<void> {
    this.db = await initializeDatabase();

    const sessionRepositoryConstructor = new SessionRepositoryConstructor(
      new SessionPostgresDialect({ pool: this.db.pool }),
      { schema: env.LOFT_SESSION_SCHEMA }
    );

    const chatHistoryRepositoryConstructor = new ChatHistoryRepositoryConstructor(
      new ChatHistoryPostgresDialect({ pool: this.db.pool }),
      { schema: env.LOFT_CHAT_HISTORY_SCHEMA }
    );

    const chatConstructor = new ChatConstructor(sessionRepositoryConstructor, chatHistoryRepositoryConstructor);

    const manifestRepository = new FsRepositoryConstructor();
    const manifestManagerConstructor = new ManifestManagerConstructor(manifestRepository, {
      manifestPath: env.LOFT_MANIFEST_PATH,
      errorPath: env.LOFT_MANIFEST_ERROR_PATH,
      cacheExpirationTime: env.LOFT_MANIFEST_CACHE_EXPIRATION
    });

    this.loftConstructor = new LoftConstructor(
      { logLevel: Interface.LogLevel[env.LOFT_LOG_LEVEL] },
      manifestManagerConstructor,
      chatConstructor
    );

    await this.loftConstructor.registerLlmStrategy(MODEL_NAME, this.createOpenAiStrategy(MODEL_NAME));

    const loft = this.loftConstructor.getInstance();
    this.chat = loft.chat as Chat.ChatInterface;

    this.logger.log(`LOFT initialized with OpenAI ${MODEL_NAME} strategy`);
  }

  async shutdown(): Promise<void> {
    if (!this.chat) return;
    this.logger.log('Shutting down LOFT...');
    try {
      // Waits for active operations, then stops the LLM rate-limiter timers
      await this.loftConstructor?.getInstance().shutdown();
      await this.loftConstructor?.gracefulShutdown();
      await this.db?.close();
      this.logger.log('LOFT shutdown complete');
    } catch (error) {
      this.logger.error('LOFT shutdown error', error);
    }
  }

  async createSession(): Promise<{ sessionId: string }> {
    const chat = this.getChat();
    const session = await chat.createSession({
      currentLlmName: MODEL_NAME,
      currentManifestName: MANIFEST_NAME,
      ctx: {}
    });
    return { sessionId: session.id };
  }

  async sendMessage(
    sessionId: string,
    message: string
  ): Promise<{ sessionId: string; response: string; status: string }> {
    const chat = this.getChat();

    const userMessage: Type.Entity.CreateMessage = {
      sessionId,
      content: [{ type: 'text', text: message }],
      role: Type.LLM.UnifiedMessageRole.user,
      author: 'user',
      llmName: MODEL_NAME,
      manifestName: MANIFEST_NAME,
      ctx: {},
      llmIgnore: false
    };

    const correlatorId = crypto.randomUUID();
    await chat.addMessages(sessionId, [correlatorId], [userMessage]);

    const result = await chat.generate({ sessionId });
    await result.messages.save();

    const topChoice = result.messages.llmResponse.topChoice;
    const responseText = topChoice.content
      .filter((part): part is Type.Entity.TextContent => part.type === 'text')
      .map((part) => part.text)
      .join('');

    return {
      sessionId: result.sessionId,
      response: responseText,
      status: result.status
    };
  }

  async getChatHistory(sessionId: string): Promise<{ sessionId: string; messages: Type.Entity.Message[] }> {
    const chat = this.getChat();
    const chatHistory = await chat.getChatHistory(sessionId);
    return { sessionId, messages: [...chatHistory] };
  }

  private createOpenAiStrategy(modelName: string) {
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
}
