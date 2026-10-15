import { DI_TYPES, Interface, Repository } from '@moc-global/loft-definitions';
import { Container, inject, injectable } from 'inversify';

export enum HealthCheckComponent {
  SESSION_REPOSITORY = 'SESSION_REPOSITORY',
  CHAT_HISTORY_MANAGER = 'CHAT_HISTORY_MANAGER',
  LLM_MANAGER = 'LLM_MANAGER'
}

export interface LoftHealthCheckInterface {
  check(components?: HealthCheckComponent[]): Promise<boolean>;
}

@injectable()
export class LoftHealthCheck implements LoftHealthCheckInterface {
  constructor(@inject(Container) private container: Container) {}

  async check(components: HealthCheckComponent[] = Object.values(HealthCheckComponent)): Promise<boolean> {
    let status = true;

    for (const component of components) {
      switch (component) {
        case HealthCheckComponent.SESSION_REPOSITORY: {
          const sessionRepository = this.container.get<Repository.Session>(DI_TYPES.SessionRepository);
          status = status && (await sessionRepository.checkHealth());
          break;
        }
        case HealthCheckComponent.CHAT_HISTORY_MANAGER: {
          const chatHistoryManager = this.container.get<Repository.ChatHistoryManager>(DI_TYPES.ChatHistoryManager);
          status = status && (await chatHistoryManager.checkHealth());
          break;
        }
        case HealthCheckComponent.LLM_MANAGER: {
          const llmManager = this.container.get<Interface.LlmManager>(DI_TYPES.LlmManager);
          const llmStrategiesStatuses = await llmManager.getHealthCheckStatuses();
          status = status && llmStrategiesStatuses.every((s: boolean) => s);
          break;
        }
      }

      if (!status) break; // Stop checking if any component is not healthy
    }

    return status;
  }
}
