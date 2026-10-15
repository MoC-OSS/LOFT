import { ApiError, Storage } from '@google-cloud/storage';
import { Logger, Repository } from '@moc-global/loft-definitions';
import { inject, injectable } from 'inversify';

import { GCP_STORAGE_DI_TYPES } from './GcpStorageDITypes';

export interface GcpStorageRepositoryConfig {
  bucketName: string;
  apiEndpoint?: string;
  projectId?: string;
}

@injectable()
export class GcpStorageRepository implements Repository.ObjectStorage {
  private readonly storage: Storage;
  private readonly log = new Logger('GcpStorageRepository');

  constructor(
    // todo: create LOFT/Repository Config provider
    @inject(GCP_STORAGE_DI_TYPES.GcpStorageRepositoryConfig) private readonly config: GcpStorageRepositoryConfig
  ) {
    const storageConfig = { ...this.config };
    this.storage = new Storage(storageConfig);
  }

  async checkHealth(): Promise<boolean> {
    try {
      this.log.trace('Checking health of gcp storage');
      const [buckets] = await this.storage.getBuckets();
      if (buckets.length === 0) return false;
      if (!buckets.find((bucket) => bucket.name === this.config.bucketName)) return false;
      return true;
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

  private async load(filePath: string) {
    try {
      const response = await this.storage.bucket(this.config.bucketName).file(filePath).download();
      return JSON.parse(response.toString());
    } catch (err) {
      this.logError(err as Error, 'load');
      throw err;
    }
  }

  private async save(filePath: string, data: Record<string, any>) {
    try {
      await this.storage
        .bucket(this.config.bucketName)
        .file(filePath)
        .save(JSON.stringify(data, null, 2));
    } catch (err) {
      this.logError(err as Error, 'saving');
      throw err;
    }
  }

  private async delete(filePath: string) {
    try {
      await this.storage.bucket(this.config.bucketName).file(filePath).delete();
    } catch (err) {
      this.logError(err as Error, 'deleting');
      throw err;
    }
  }

  private logError(err: Error, action: string) {
    const trace = err.stack;
    let message = err.message;
    if (err instanceof ApiError) {
      const errors = err.errors?.map((e) => e.message).join('\n');
      message = `${err.message}${errors ? `\nErrors: \n${errors}` : ''}`;
    } else if (err instanceof SyntaxError) {
      action = 'parsing';
    }
    this.log.error(`GCP Storage ${action} error: ${message}`, { trace });
  }
}
