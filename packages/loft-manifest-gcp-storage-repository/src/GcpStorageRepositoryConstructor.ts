import 'reflect-metadata';

import { Interface, Repository } from '@moc-global/loft-definitions';
import { Container } from 'inversify';

import { GCP_STORAGE_DI_TYPES } from './GcpStorageDITypes';
import { GcpStorageRepository, GcpStorageRepositoryConfig } from './GcpStorageRepository';

export class GcpStorageRepositoryConstructor implements Interface.BaseComponentConstructor<Repository.ObjectStorage> {
  protected gcpStorageRepositoryContainer: Container;
  constructor(private readonly config: GcpStorageRepositoryConfig) {
    this.gcpStorageRepositoryContainer = new Container();
  }

  initializeContainer(parentContainer: Container) {
    this.gcpStorageRepositoryContainer.parent = parentContainer;

    this.gcpStorageRepositoryContainer
      .bind<GcpStorageRepositoryConfig>(GCP_STORAGE_DI_TYPES.GcpStorageRepositoryConfig)
      .toConstantValue(this.config);
    this.gcpStorageRepositoryContainer
      .bind<Repository.ObjectStorage>(GCP_STORAGE_DI_TYPES.GcpStorageRepository)
      .to(GcpStorageRepository);
  }

  getInstance(): Repository.ObjectStorage {
    return this.gcpStorageRepositoryContainer.get<Repository.ObjectStorage>(GCP_STORAGE_DI_TYPES.GcpStorageRepository);
  }
}
