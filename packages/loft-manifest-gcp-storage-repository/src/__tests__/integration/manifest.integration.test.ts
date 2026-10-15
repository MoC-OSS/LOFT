import 'reflect-metadata';

import { Repository } from '@moc-global/loft-definitions';
import { testObjectStorageAdapterRepository } from '@moc-global/loft-definitions/src/__tests__';
import { describe } from 'vitest';

import { GCP_STORAGE_DI_TYPES } from '../../GcpStorageDITypes';
import { testContainer } from './di.init';

const repository = testContainer.get<Repository.ObjectStorage>(GCP_STORAGE_DI_TYPES.GcpStorageRepository);

describe('GCP Storage Adapter Manifest Integration Test', () => {
  testObjectStorageAdapterRepository(repository);
});
