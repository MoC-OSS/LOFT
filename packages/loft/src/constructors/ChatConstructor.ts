import 'reflect-metadata';

import {
  BeforeGenerateMiddleware,
  BeforeGenerateMiddlewareManager,
  Chat,
  ContextInterface,
  ContextProviderInterface,
  createBeforeGenerateMiddlewareManager,
  createStandardMiddlewareManager,
  DI_TYPES,
  GenerateRequestParameters,
  Interface,
  Repository,
  StandardMiddleware,
  StandardMiddlewareManager,
  Strategy
} from '@moc-global/loft-definitions';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Container } from 'inversify';

import { LlmContextWindowCropper } from '../base-components';
import { LoftHealthCheck, LoftHealthCheckInterface } from '../LoftHealthCheck';
import { ChatHistoryManager } from '../managers/ChatHistoryManager';
import { MCPManager } from '../managers/MCPManager';
import { ToolInterceptorManager } from '../managers/ToolInterceptorManager';
import { ContextProvider } from '../providers/ContextProvider';
import {
  GenerateResultMessagesProvider,
  GenerateResultMessagesProviderInterface
} from '../providers/GenerateResultMessagesProvider';
import { ChatConfig } from '../types';
import { BaseLoftChat } from '../workflows';

export class ChatConstructor<T = BaseLoftChat>
  extends Interface.BaseComponentConstructor<T>
  implements Interface.ChatConstructor<T>
{
  protected chatContainer: Container;

  constructor(
    private readonly sessionRepositoryConstructor: Interface.BaseComponentConstructor<Repository.Session>,
    private readonly chatHistoryRepositoryConstructor: Interface.BaseComponentConstructor<Repository.ChatHistory>,
    private readonly chatHistoryPatcherRepositoryConstructor?: Interface.BaseComponentConstructor<Repository.ChatHistoryPatcher>,
    private readonly llmContextWindowCropper?: Strategy.LlmContextWindowCropper,
    private readonly chatConfig?: ChatConfig
  ) {
    super();
    this.chatContainer = new Container();
  }

  public initializeContainer(mainContainer: Container): void {
    this.chatContainer.parent = mainContainer;
    this.chatContainer
      .bind(Container)
      .toDynamicValue((ctx) => ctx.container as Container)
      .inSingletonScope();

    this.chatContainer.bind<LoftHealthCheckInterface>(DI_TYPES.LoftHealthCheck).to(LoftHealthCheck);
    this.bindChatDependencies(this.chatConfig);

    this.chatContainer.bind<Interface.MCP.MCPManager>(DI_TYPES.MCPManager).to(MCPManager).inSingletonScope();
    this.chatContainer
      .bind<Interface.ToolInterceptorManager>(DI_TYPES.ToolInterceptorManager)
      .to(ToolInterceptorManager)
      .inSingletonScope();

    this.initializeConstructors(
      this.sessionRepositoryConstructor,
      this.chatHistoryRepositoryConstructor,
      this.chatHistoryPatcherRepositoryConstructor
    );

    this.chatBind();
  }

  public getInstance(): T {
    return this.chatContainer.get<BaseLoftChat>(DI_TYPES.ChatStrategy) as T;
  }

  protected chatBind() {
    this.chatContainer.bind<BaseLoftChat>(DI_TYPES.ChatStrategy).to(BaseLoftChat).inSingletonScope();
  }

  private initializeConstructors(
    sessionRepositoryConstructor: Interface.BaseComponentConstructor<Repository.Session>,
    chatHistoryRepositoryConstructor: Interface.BaseComponentConstructor<Repository.ChatHistory>,
    chatHistoryPatcherRepositoryConstructor?: Interface.BaseComponentConstructor<Repository.ChatHistoryPatcher>
  ) {
    sessionRepositoryConstructor.initializeContainer(this.chatContainer);
    const sessionRepository = sessionRepositoryConstructor.getInstance();
    this.chatContainer.bind<Repository.Session>(DI_TYPES.SessionRepository).toConstantValue(sessionRepository);

    chatHistoryRepositoryConstructor.initializeContainer(this.chatContainer);
    const chatHistoryRepository = chatHistoryRepositoryConstructor.getInstance();
    this.chatContainer
      .bind<Repository.ChatHistory>(DI_TYPES.ChatHistoryRepository)
      .toConstantValue(chatHistoryRepository);

    if (chatHistoryPatcherRepositoryConstructor) {
      chatHistoryPatcherRepositoryConstructor.initializeContainer(this.chatContainer);
      const chatHistoryPatcherRepository = chatHistoryPatcherRepositoryConstructor.getInstance();
      this.chatContainer
        .bind<Repository.ChatHistoryPatcher>(DI_TYPES.ChatHistoryPatcherRepository)
        .toConstantValue(chatHistoryPatcherRepository);
    }
  }

  private bindChatDependencies(chatConfig?: ChatConfig /* logStrategy: Interface.LoggerStrategy */) {
    this.chatContainer
      .bind<ChatConfig>(DI_TYPES.ChatConfig)
      .toConstantValue(chatConfig || { mcp: { toolCacheTtl: 60000 } });
    this.chatContainer.bind<ChatHistoryManager>(DI_TYPES.ChatHistoryManager).to(ChatHistoryManager);

    this.chatContainer.bind<ContextProviderInterface>(DI_TYPES.ContextProvider).to(ContextProvider).inSingletonScope();
    this.chatContainer
      .bind<GenerateResultMessagesProviderInterface>(DI_TYPES.GenerateResultMessagesProvider)
      .to(GenerateResultMessagesProvider);

    // Register LlmContextWindowCropper - use provided instance or create default
    if (this.llmContextWindowCropper) {
      this.chatContainer
        .bind<Strategy.LlmContextWindowCropper>(DI_TYPES.LlmContextWindowCropper)
        .toConstantValue(this.llmContextWindowCropper);
    } else {
      this.chatContainer
        .bind<Strategy.LlmContextWindowCropper>(DI_TYPES.LlmContextWindowCropper)
        .to(LlmContextWindowCropper)
        .inSingletonScope();
    }

    const inputMiddlewareManager: StandardMiddlewareManager<ContextInterface, GenerateRequestParameters> =
      createStandardMiddlewareManager<ContextInterface, GenerateRequestParameters>('Input');
    const beforeGenerateMiddlewareManager: BeforeGenerateMiddlewareManager<
      ContextInterface,
      GenerateRequestParameters
    > = createBeforeGenerateMiddlewareManager<ContextInterface, GenerateRequestParameters>('BeforeGenerate');
    const afterGenerateMiddlewareManager = createStandardMiddlewareManager<
      ContextInterface,
      Chat.GenerateResultMessages
    >('AfterGenerate');

    this.chatContainer
      .bind<StandardMiddlewareManager<ContextInterface, GenerateRequestParameters>>(DI_TYPES.InputMiddleware)
      .toConstantValue(inputMiddlewareManager);
    this.chatContainer
      .bind<BeforeGenerateMiddlewareManager<ContextInterface, GenerateRequestParameters>>(
        DI_TYPES.BeforeGenerateMiddlewareManager
      )
      .toConstantValue(beforeGenerateMiddlewareManager);
    this.chatContainer
      .bind<StandardMiddlewareManager<ContextInterface, Chat.GenerateResultMessages>>(
        DI_TYPES.AfterGenerateMiddlewareManager
      )
      .toConstantValue(afterGenerateMiddlewareManager);
  }

  public registerInputMiddleware(
    name: string,
    middleware: StandardMiddleware<ContextInterface, GenerateRequestParameters>
  ) {
    const inputMiddlewareManager = this.chatContainer.get<
      StandardMiddlewareManager<ContextInterface, GenerateRequestParameters>
    >(DI_TYPES.InputMiddleware);
    inputMiddlewareManager.use(name, middleware);
  }

  public registerBeforeGenerateMiddleware(
    name: string,
    middleware: BeforeGenerateMiddleware<ContextInterface, GenerateRequestParameters>
  ) {
    const beforeGenerateMiddlewareManager = this.chatContainer.get<
      BeforeGenerateMiddlewareManager<ContextInterface, GenerateRequestParameters>
    >(DI_TYPES.BeforeGenerateMiddlewareManager);
    beforeGenerateMiddlewareManager.use(name, middleware);
  }

  public registerAfterGenerateMiddleware(
    name: string,
    middleware: StandardMiddleware<ContextInterface, Chat.GenerateResultMessages>
  ) {
    const afterGenerateMiddlewareManager = this.chatContainer.get<
      StandardMiddlewareManager<ContextInterface, Chat.GenerateResultMessages>
    >(DI_TYPES.AfterGenerateMiddlewareManager);
    afterGenerateMiddlewareManager.use(name, middleware);
  }

  public async useMcpClient(mcpName: string, mcpClient: Client, metadata?: Partial<Interface.MCP.MCPClientMetadata>) {
    const mcpManager = this.chatContainer.get<Interface.MCP.MCPManager>(DI_TYPES.MCPManager);
    return await mcpManager.useClient(mcpName, mcpClient, metadata);
  }

  public registerToolInterceptor(mcpToolName: string, interceptor: Interface.ToolInterceptor) {
    const toolInterceptorManager = this.chatContainer.get<Interface.ToolInterceptorManager>(
      DI_TYPES.ToolInterceptorManager
    );
    toolInterceptorManager.use(mcpToolName, interceptor);
  }
}
