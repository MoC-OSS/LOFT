import { randomUUID } from 'node:crypto';

import {
  Chat,
  ContextProviderInterface,
  deepMerge,
  Interface,
  Logger,
  Repository,
  ShutdownError,
  Type,
  Util
} from '@moc-global/loft-definitions';
import { injectable } from 'inversify';
@injectable()
export abstract class AbstractLoftChat implements Chat.AbstractLoftChatInterface {
  protected isShuttingDown = false;
  private activeOperations = new Set<string>();
  protected readonly log = new Logger('AbstractLoftChat');

  constructor(
    protected readonly sessionRepository: Repository.Session,
    protected readonly chatHistoryManager: Repository.ChatHistoryManager,
    protected readonly contextProvider: ContextProviderInterface,
    protected readonly llmManager: Interface.LlmManager
  ) {}

  public async shutdown() {
    this.log.info('LOFT Chat: Received shutdown signal, initiating graceful shutdown...');
    this.isShuttingDown = true;

    // Wait for active operations to complete
    if (this.activeOperations.size > 0) {
      this.log.info(`LOFT Chat: Waiting for ${this.activeOperations.size} active operations to complete...`);
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.activeOperations.size === 0) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });
    }

    this.log.info('LOFT Chat: Graceful shutdown completed');
  }

  protected async withOperation<T>(operationId: string, operation: () => Promise<T>): Promise<T> {
    if (this.isShuttingDown && !this.activeOperations.has(operationId)) {
      throw new ShutdownError(operationId, 'LOFT Chat: Service is shutting down, new operations are not accepted');
    }

    this.activeOperations.add(operationId);
    try {
      return await operation();
    } finally {
      this.activeOperations.delete(operationId);
    }
  }

  public async createSession(newSession: Type.Entity.CreateSession) {
    const operationId = `createSession-${randomUUID()}-${Date.now()}`;
    return this.withOperation(operationId, async () => {
      const sessionData = await this.sessionRepository.create(newSession);

      this.log.trace(`LOFT Session Entity created: `, sessionData.id);

      return sessionData;
    });
  }

  public async deleteSession(sessionId: Type.Entity.Session['id']): Promise<void> {
    const operationId = `deleteSession-${sessionId}-${randomUUID()}-${Date.now()}`;
    return this.withOperation(operationId, async () => {
      await this.sessionRepository.deleteById(sessionId);

      this.log.trace(`LOFT Session Entity deleted: ${sessionId}`);
    });
  }

  // used to get the session data from ChatStrategy
  public async getSessionById(sessionId: Type.Entity.Session['id']): Promise<Type.Entity.Session> {
    const operationId = `getSessionById-${sessionId}-${randomUUID()}-${Date.now()}`;
    return this.withOperation(operationId, async () => {
      this.log.trace(`Getting session by id: ${sessionId}`);
      return this.sessionRepository.getById(sessionId);
    });
  }

  public async getSessionByExternalKey(externalKey: Type.Entity.Session['externalKey']): Promise<Type.Entity.Session> {
    const operationId = `getSessionByExternalKey-${externalKey}-${randomUUID()}-${Date.now()}`;
    return this.withOperation(operationId, async () => {
      this.log.trace(`Getting session by external key: ${externalKey}`);
      return this.sessionRepository.getByExternalKey(externalKey);
    });
  }

  public async updateSessionSettings(
    sessionId: Type.Entity.Session['id'],
    correlatorId: string,
    settings: Partial<Type.Entity.CreateSession>
  ): Promise<void> {
    const operationId = `updateSessionSettings-${sessionId}-${correlatorId}-${randomUUID()}-${Date.now()}`;
    return this.withOperation(operationId, async () => {
      this.log.trace(`Updating session settings`, { sessionId, correlatorId });
      const session = await this.sessionRepository.getById(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      const mergedCtx = deepMerge(session.ctx, settings?.ctx || {}, this.log);
      const updatedSessionData = {
        ...session,
        ...settings,
        ctx: mergedCtx
      };

      await this.sessionRepository.updateById(sessionId, updatedSessionData);
    });
  }

  public async getChatHistory(
    sessionId: Type.Entity.Session['id']
  ): Promise<Util.QueryByArrayOfObjects<Type.Entity.Message>> {
    const operationId = `getChatHistory-${sessionId}-${randomUUID()}-${Date.now()}`;
    return this.withOperation(operationId, async () => {
      const messages = await this.chatHistoryManager.getMessages(sessionId);

      const ChatHistoryReadOnly = new Util.QueryByArrayOfObjects(...messages);

      return ChatHistoryReadOnly;
    });
  }
}
