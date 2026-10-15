import 'reflect-metadata';

import { Interface, Repository } from '@moc-global/loft-definitions';
import { Container } from 'inversify';
import { CamelCasePlugin, Dialect, Kysely } from 'kysely';

import { CHAT_HISTORY_DI_TYPES } from './ChatHistoryDITypes';
import { Database } from './dbTypes';
import { ChatHistoryRepository, HealthCheckService } from './repository';
import { ChatHistoryConfig } from './repository/config';

export class ChatHistoryRepositoryConstructor implements Interface.BaseComponentConstructor<Repository.ChatHistory> {
  protected coreRepositoryContainer: Container;

  constructor(
    private readonly dialect: Dialect,
    private readonly chatHistoryConfig: ChatHistoryConfig
  ) {
    this.coreRepositoryContainer = new Container();
  }

  initializeContainer(mainContainer: Container) {
    this.coreRepositoryContainer.parent = mainContainer;

    this.coreRepositoryContainer.bind<Dialect>(CHAT_HISTORY_DI_TYPES.ChatHistoryDialect).toConstantValue(this.dialect);
    this.coreRepositoryContainer
      .bind<ChatHistoryConfig>(CHAT_HISTORY_DI_TYPES.ChatHistoryConfig)
      .toConstantValue(this.chatHistoryConfig);
    this.coreRepositoryContainer.bind<Kysely<Database>>(CHAT_HISTORY_DI_TYPES.ChatHistoryDatabase).toConstantValue(
      new Kysely<Database>({
        dialect: this.dialect,
        // Only column names are converted; keys inside jsonb columns (content, ctx) are user data and stay as written
        plugins: [new CamelCasePlugin({ maintainNestedObjectKeys: true })]
      })
    );
    this.coreRepositoryContainer
      .bind<Repository.ChatHistory>(CHAT_HISTORY_DI_TYPES.ChatHistoryRepository)
      .to(ChatHistoryRepository);
    this.coreRepositoryContainer
      .bind<HealthCheckService>(CHAT_HISTORY_DI_TYPES.ChatHistoryHealthCheckService)
      .to(HealthCheckService);
  }

  getInstance(): Repository.ChatHistory {
    return this.coreRepositoryContainer.get<Repository.ChatHistory>(CHAT_HISTORY_DI_TYPES.ChatHistoryRepository);
  }
}
