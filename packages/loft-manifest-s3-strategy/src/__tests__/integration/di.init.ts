import { Interface, Logger, PinoLoggerStrategy, Repository } from '@moc-global/loft-definitions';
import { Container } from 'inversify';

import { AwsS3RepositoryConstructor } from '../../';
import { AWS_S3_DI_TYPES } from '../../AwsS3DITypes';
import { config } from './config';

const testContainer = new Container();

// Configure Logger for tests
Logger.configure({
  logLevel: Interface.LogLevel.TRACE,
  loggerStrategy: new PinoLoggerStrategy()
});

const manifestRepository = new AwsS3RepositoryConstructor({
  region: config.S3_REGION,
  bucketName: config.S3_BUCKET_NAME,
  endpoint: config.S3_ENDPOINT,
  forcePathStyle: true
});

manifestRepository.initializeContainer(testContainer);

const s3Repository = manifestRepository.getInstance();
testContainer.bind<Repository.ObjectStorage>(AWS_S3_DI_TYPES.AwsS3Repository).toConstantValue(s3Repository);

export { testContainer };
