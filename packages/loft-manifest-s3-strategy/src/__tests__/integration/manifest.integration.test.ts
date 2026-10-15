import 'reflect-metadata';

import { Repository } from '@moc-global/loft-definitions';
import { testObjectStorageAdapterRepository } from '@moc-global/loft-definitions/src/__tests__';
import { describe } from 'vitest';

import { AWS_S3_DI_TYPES } from '../../AwsS3DITypes';
import { testContainer } from './di.init';

const repository = testContainer.get<Repository.ObjectStorage>(AWS_S3_DI_TYPES.AwsS3Repository);

describe('S3 Adapter Manifest Integration Test', () => {
  testObjectStorageAdapterRepository(repository);
});
