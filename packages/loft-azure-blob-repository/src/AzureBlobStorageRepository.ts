import { BlobServiceClient } from '@azure/storage-blob';
import { Logger, Repository } from '@moc-global/loft-definitions';
import { inject, injectable } from 'inversify';

import { AZURE_BLOB_STORAGE_DI_TYPES } from './AzureBlobStorageDITypes';

export interface AzureBlobStorageRepositoryConfig {
  containerName: string;
  connectionString: string;
}

@injectable()
export class AzureBlobStorageRepository implements Repository.ObjectStorage {
  private readonly blobServiceClient: BlobServiceClient;
  private readonly log = new Logger('AzureBlobStorageRepository');

  constructor(
    // todo: create LOFT/Repository Config provider
    @inject(AZURE_BLOB_STORAGE_DI_TYPES.AzureBlobStorageRepositoryConfig)
    private readonly config: AzureBlobStorageRepositoryConfig
  ) {
    this.blobServiceClient = BlobServiceClient.fromConnectionString(config.connectionString);
  }

  async checkHealth(): Promise<boolean> {
    try {
      this.log.trace('Checking health of azure blob storage');
      const containerClient = this.blobServiceClient.getContainerClient(this.config.containerName);
      const exists = await containerClient.exists();
      return exists;
    } catch (err) {
      this.logError(err as Error, 'health check');
      return false;
    }
  }

  get(filePath: string): Promise<any> {
    return this.load(filePath);
  }

  upload(filePath: string, data: Record<string, any>): Promise<void> {
    return this.save(filePath, data);
  }

  remove(filePath: string): Promise<void> {
    return this.delete(filePath);
  }

  private getBlobClient(filePath: string) {
    const containerClient = this.blobServiceClient.getContainerClient(this.config.containerName);
    return containerClient.getBlockBlobClient(filePath);
  }

  private async load(filePath: string) {
    try {
      const blobClient = this.getBlobClient(filePath);
      const response = await blobClient.downloadToBuffer();
      const blobBody = response.toString();
      return JSON.parse(blobBody);
    } catch (err) {
      this.logError(err as Error, 'load');
      throw err;
    }
  }

  private async save(filePath: string, data: Record<string, any>) {
    try {
      const blobClient = this.getBlobClient(filePath);
      const dataString = JSON.stringify(data, null, 2);
      await blobClient.upload(dataString, dataString.length, {
        blobHTTPHeaders: {
          blobContentType: 'application/json'
        }
      });
    } catch (err) {
      this.logError(err as Error, 'saving');
      throw err;
    }
  }

  private async delete(filePath: string) {
    try {
      const blobClient = this.getBlobClient(filePath);
      await blobClient.delete();
    } catch (err) {
      this.logError(err as Error, 'deleting');
      throw err;
    }
  }

  private logError(err: Error, action: string) {
    const trace = err.stack;
    const message = err.message;
    // if (err instanceof ApiError) {
    //   const errors = err.errors?.map((e) => e.message).join('\n');
    //   message = `${err.message}${errors ? `\nErrors: \n${errors}` : ''}`;
    // } else if (err instanceof SyntaxError) {
    //   action = 'parsing';
    // }
    this.log.error(`Azure Blob Storage ${action} error`, message, trace);
  }
}
