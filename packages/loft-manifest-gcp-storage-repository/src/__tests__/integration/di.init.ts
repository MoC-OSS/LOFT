import { Interface, Logger, PinoLoggerStrategy, Repository } from '@moc-global/loft-definitions';
import { Container } from 'inversify';

import { GCP_STORAGE_DI_TYPES } from '../../GcpStorageDITypes';
import { GcpStorageRepositoryConstructor } from '../../GcpStorageRepositoryConstructor';
import { config } from './config';

const testContainer = new Container();

// Configure Logger for tests
Logger.configure({
  logLevel: Interface.LogLevel.TRACE,
  loggerStrategy: new PinoLoggerStrategy()
});

const manifestRepository = new GcpStorageRepositoryConstructor({
  bucketName: config.GCP_BUCKET,
  apiEndpoint: config.GCP_API_ENDPOINT,
  projectId: config.GCP_API_PROJECT_ID
});

manifestRepository.initializeContainer(testContainer);

const gcpRepository = manifestRepository.getInstance();
testContainer.bind<Repository.ObjectStorage>(GCP_STORAGE_DI_TYPES.GcpStorageRepository).toConstantValue(gcpRepository);

export { testContainer };
