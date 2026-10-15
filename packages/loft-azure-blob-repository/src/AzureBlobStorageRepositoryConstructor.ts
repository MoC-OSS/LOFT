import 'reflect-metadata';

import { Interface, Repository } from '@moc-global/loft-definitions';
import { Container } from 'inversify';

import { AZURE_BLOB_STORAGE_DI_TYPES } from './AzureBlobStorageDITypes';
import { AzureBlobStorageRepository, AzureBlobStorageRepositoryConfig } from './AzureBlobStorageRepository';

export class AzureBlobStorageRepositoryConstructor implements Interface.BaseComponentConstructor<Repository.ObjectStorage> {
  protected azureBlobStorageRepositoryContainer: Container;
  constructor(private readonly config: AzureBlobStorageRepositoryConfig) {
    this.azureBlobStorageRepositoryContainer = new Container();
  }

  initializeContainer(parentContainer: Container) {
    this.azureBlobStorageRepositoryContainer.parent = parentContainer;

    this.azureBlobStorageRepositoryContainer
      .bind<AzureBlobStorageRepositoryConfig>(AZURE_BLOB_STORAGE_DI_TYPES.AzureBlobStorageRepositoryConfig)
      .toConstantValue(this.config);
    this.azureBlobStorageRepositoryContainer
      .bind<Repository.ObjectStorage>(AZURE_BLOB_STORAGE_DI_TYPES.AzureBlobStorageRepository)
      .to(AzureBlobStorageRepository);
  }

  getInstance(): Repository.ObjectStorage {
    return this.azureBlobStorageRepositoryContainer.get<Repository.ObjectStorage>(
      AZURE_BLOB_STORAGE_DI_TYPES.AzureBlobStorageRepository
    );
  }
}
