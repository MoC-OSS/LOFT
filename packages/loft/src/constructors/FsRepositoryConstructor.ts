import 'reflect-metadata';

import { DI_TYPES, Interface, Repository } from '@moc-global/loft-definitions';
import { Container } from 'inversify';

import { FsRepository } from '../base-components';

export class FsRepositoryConstructor implements Interface.BaseComponentConstructor<Repository.ObjectStorage> {
  protected fsRepositoryContainer: Container;

  constructor() {
    this.fsRepositoryContainer = new Container();
  }

  initializeContainer(mainContainer: Container) {
    this.fsRepositoryContainer.parent = mainContainer;
    this.fsRepositoryContainer.bind<Repository.ObjectStorage>(DI_TYPES.ManifestRepository).to(FsRepository);
  }

  getInstance(): Repository.ObjectStorage {
    return this.fsRepositoryContainer.get<Repository.ObjectStorage>(DI_TYPES.ManifestRepository);
  }
}
