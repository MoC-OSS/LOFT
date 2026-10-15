import { Interface, Logger, PinoLoggerStrategy, Repository } from '@moc-global/loft-definitions';
import { Container } from 'inversify';

import { AZURE_BLOB_STORAGE_DI_TYPES } from '../../AzureBlobStorageDITypes';
import { AzureBlobStorageRepositoryConstructor } from '../../AzureBlobStorageRepositoryConstructor';
import { config } from './config';

const testContainer = new Container();

// Configure Logger for tests
Logger.configure({
  logLevel: Interface.LogLevel.TRACE,
  loggerStrategy: new PinoLoggerStrategy()
});

const manifestRepository = new AzureBlobStorageRepositoryConstructor({
  containerName: config.AZURE_BLOB_STORAGE_CONTAINER_NAME,
  connectionString: config.AZURE_BLOB_STORAGE_CONNECTION_STRING
});

manifestRepository.initializeContainer(testContainer);

const azureBlobStorageRepository = manifestRepository.getInstance();
testContainer
  .bind<Repository.ObjectStorage>(AZURE_BLOB_STORAGE_DI_TYPES.AzureBlobStorageRepository)
  .toConstantValue(azureBlobStorageRepository);

export { testContainer };
