import 'reflect-metadata';

import { Interface, Repository } from '@moc-global/loft-definitions';
import { Container } from 'inversify';
import { CamelCasePlugin, Dialect, Kysely } from 'kysely';

import { Database } from './dbTypes';
import { HealthCheckService, SessionRepository } from './repository';
import { SessionRepositoryConfig } from './repository/config';
import { SESSION_DI_TYPES } from './SessionDITypes';

export class SessionRepositoryConstructor implements Interface.BaseComponentConstructor<Repository.Session> {
  protected sessionRepositoryContainer: Container;

  constructor(
    private readonly dialect: Dialect,
    private readonly sessionRepositoryConfig: SessionRepositoryConfig
  ) {
    this.sessionRepositoryContainer = new Container();
  }

  initializeContainer(mainContainer: Container) {
    this.sessionRepositoryContainer.parent = mainContainer;
    this.sessionRepositoryContainer
      .bind<HealthCheckService>(SESSION_DI_TYPES.HealthCheckService)
      .to(HealthCheckService);
    this.sessionRepositoryContainer
      .bind<Dialect>(SESSION_DI_TYPES.SessionRepositoryDialect)
      .toConstantValue(this.dialect);
    this.sessionRepositoryContainer
      .bind<SessionRepositoryConfig>(SESSION_DI_TYPES.SessionRepositoryConfig)
      .toConstantValue(this.sessionRepositoryConfig);
    this.sessionRepositoryContainer.bind<Kysely<Database>>(SESSION_DI_TYPES.SessionRepositoryDatabase).toConstantValue(
      new Kysely<Database>({
        dialect: this.dialect,
        plugins: [new CamelCasePlugin()]
      })
    );

    this.sessionRepositoryContainer.bind<Repository.Session>(SESSION_DI_TYPES.SessionRepository).to(SessionRepository);
  }

  getInstance(): Repository.Session {
    return this.sessionRepositoryContainer.get<Repository.Session>(SESSION_DI_TYPES.SessionRepository);
  }
}
