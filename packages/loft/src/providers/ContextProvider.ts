import { randomUUID } from 'node:crypto';

import {
  Context,
  ContextInterface,
  ContextProviderInterface,
  DI_TYPES,
  GenerateRequestParameters,
  Interface,
  Logger,
  Repository,
  Type
} from '@moc-global/loft-definitions';
import { Container, inject, injectable } from 'inversify';

import { ChatHistory, Session } from '../entities';

@injectable()
export class ContextProvider implements ContextProviderInterface {
  private container: Container;
  protected readonly log = new Logger('ContextProvider');

  constructor(@inject(Container) container: Container) {
    this.container = container;
  }

  private async fetchSession(
    sessionId: string,
    sessionData?: Type.Entity.Session | Interface.FacadeEntity.Session
  ): Promise<Interface.FacadeEntity.Session> {
    const sessionRepository: Repository.Session = this.container.get<Repository.Session>(DI_TYPES.SessionRepository);

    if (!sessionData) {
      sessionData = await sessionRepository.getById(sessionId);
    }

    const rawSession = {
      ...sessionData,
      ctx: sessionData.ctx // For Session objects, ctx is a getter, so we get the value directly
    };

    return new Session(sessionRepository, rawSession);
  }

  private async fetchChatHistory(
    sessionId: string,
    chatHistoryData?: Type.Entity.ChatHistory
  ): Promise<Interface.FacadeEntity.ChatHistory> {
    const chatHistoryManager: Repository.ChatHistoryManager = this.container.get<Repository.ChatHistoryManager>(
      DI_TYPES.ChatHistoryManager
    );

    if (!chatHistoryData) {
      chatHistoryData = await chatHistoryManager.getMessages(sessionId);
    }
    return new ChatHistory(sessionId, chatHistoryManager, chatHistoryData);
  }

  public async get(
    sessionId: string,
    generateRequestParameters?: GenerateRequestParameters,
    correlatorIds?: string[]
  ): Promise<ContextInterface> {
    if (!sessionId) throw new Error('sessionId is missing');

    const session = await this.fetchSession(sessionId);
    const chatHistory = await this.fetchChatHistory(sessionId);
    const llmManager = this.container.get<Interface.LlmManager>(DI_TYPES.LlmManager);
    const tracerStrategy = this.container.get(DI_TYPES.TracerStrategy);

    const tracer = (tracerStrategy as any).createTracer({
      traceId: randomUUID(),
      name: `loft-generate-${sessionId}`,
      sessionId: sessionId,
      // metadata: {
      //   correlatorIds: correlatorIds || [],
      //   timestamp: new Date()
      // },
      tags: generateRequestParameters?.tags || []
    });

    return new Context(session, chatHistory, llmManager, tracer, generateRequestParameters, correlatorIds);
  }

  public async update(
    context: ContextInterface,
    generateRequestParameters?: GenerateRequestParameters,
    correlatorIds?: string[]
  ): Promise<ContextInterface> {
    // Create base parameters from context or provided parameters
    const newGenerateRequestParameters: GenerateRequestParameters = generateRequestParameters || {
      augmentedContext: context.request.messages.augmentedContext,
      directMessages: context.request.messages.directMessages,
      temporaryRequestConfig: context.request.messages.temporaryRequestConfig || {}
    };

    const session = await this.fetchSession(context.session.id, context.session);
    const chatHistory = await this.fetchChatHistory(context.session.id, context.chatHistory.messages);
    const llmManager = this.container.get<Interface.LlmManager>(DI_TYPES.LlmManager);
    correlatorIds = Array.from(new Set([...context.request.correlatorIds, ...(correlatorIds ?? [])]));

    // Reuse the existing tracer from the context - context flows through entire request
    return new Context(
      session,
      chatHistory,
      llmManager,
      context.tracer as any,
      newGenerateRequestParameters,
      correlatorIds
    );
  }
}
