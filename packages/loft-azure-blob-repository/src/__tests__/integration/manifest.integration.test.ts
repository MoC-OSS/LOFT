import 'reflect-metadata';

import { Repository } from '@moc-global/loft-definitions';
import { testObjectStorageAdapterRepository } from '@moc-global/loft-definitions/src/__tests__';
import { describe } from 'vitest';

import { AZURE_BLOB_STORAGE_DI_TYPES } from '../../AzureBlobStorageDITypes';
import { testContainer } from './di.init';

const repository = testContainer.get<Repository.ObjectStorage>(AZURE_BLOB_STORAGE_DI_TYPES.AzureBlobStorageRepository);

describe('Azure Blob Storage Adapter Manifest Integration Test', () => {
  testObjectStorageAdapterRepository(repository);
});
