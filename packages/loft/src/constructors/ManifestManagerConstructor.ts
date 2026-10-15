import 'reflect-metadata';

import { ContextInterface, DI_TYPES, Interface, Repository } from '@moc-global/loft-definitions';
import { Container, ContainerModule } from 'inversify';

import { ComputerManager, ManifestManager } from '../managers';

export class ManifestManagerConstructor implements Interface.BaseModuleConstructor<Interface.ManifestManager> {
  constructor(
    private readonly manifestRepositoryConstructor: Interface.BaseComponentConstructor<Repository.ObjectStorage>,
    private readonly manifestManagerConfig: Interface.ManifestManagerConfig
  ) {}

  getModule(parentContainer: Container): ContainerModule {
    return new ContainerModule(async (bind) => {
      this.manifestRepositoryConstructor.initializeContainer(parentContainer);
      const manifestRepository = this.manifestRepositoryConstructor.getInstance();
      bind<Repository.ObjectStorage>(DI_TYPES.ManifestRepository).toConstantValue(manifestRepository);

      bind<Interface.ManifestManager>(DI_TYPES.ManifestManager).to(ManifestManager).inSingletonScope();

      bind<Interface.ManifestManagerConfig>(DI_TYPES.ManifestManagerConfig).toConstantValue(this.manifestManagerConfig);

      bind<Interface.ComputerManager<ContextInterface>>(DI_TYPES.GMComputerManager)
        .toDynamicValue(() => new ComputerManager<ContextInterface>('AgentPrompt')) // TODO: change naming
        .inSingletonScope();

      bind<Interface.ComputerManager<ContextInterface>>(DI_TYPES.ATMComputerManager)
        .toDynamicValue(() => new ComputerManager<ContextInterface>('AITaskPrompt')) // TODO: change naming
        .inSingletonScope();

      bind<Interface.ComputerManager<ContextInterface>>(DI_TYPES.PromptComputerManager)
        .toDynamicValue(() => new ComputerManager<ContextInterface>('Prompt')) // TODO: change naming
        .inSingletonScope();
    });
  }
}
