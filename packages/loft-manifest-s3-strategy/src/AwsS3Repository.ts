import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListBucketsCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand
} from '@aws-sdk/client-s3';
import { Logger, Repository } from '@moc-global/loft-definitions';
import { inject, injectable } from 'inversify';

import { AWS_S3_DI_TYPES } from './AwsS3DITypes';

export interface AwsS3RepositoryConfig {
  region: string;
  bucketName: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}

@injectable()
export class AwsS3Repository implements Repository.ObjectStorage {
  private readonly client: S3Client;
  private readonly log = new Logger('AwsS3Repository');

  constructor(@inject(AWS_S3_DI_TYPES.AwsS3RepositoryConfig) private readonly config: AwsS3RepositoryConfig) {
    const s3Config: {
      region: string;
      endpoint?: string;
      forcePathStyle?: boolean;
    } = { region: this.config.region };
    if (this.config.endpoint) {
      s3Config.endpoint = this.config.endpoint;
    }
    if (this.config.forcePathStyle) {
      s3Config.forcePathStyle = this.config.forcePathStyle;
    }

    this.client = new S3Client(s3Config);
  }

  async checkHealth(): Promise<boolean> {
    try {
      this.log.trace('Checking health of s3');
      const command = new ListBucketsCommand({});
      const response = await this.client.send(command);
      if (response.Buckets?.length === 0) return false;
      if (!response.Buckets?.find((bucket) => bucket.Name === this.config.bucketName)) return false;
      this.log.trace('S3 health check passed');
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

  private async load(filePath: string): Promise<any> {
    const command = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: filePath
    });
    try {
      this.log.trace(`Loading file from s3: ${filePath}`);

      const response = await this.client.send(command);
      if (!response.Body) throw new Error('Failed to load file from s3');
      const bodyString = await response.Body.transformToString();

      if (!bodyString) throw new Error('Failed to load file from s3');

      this.log.trace(`Parsing file from s3: ${filePath}`);
      const data = JSON.parse(bodyString);

      this.log.trace(`Loaded file from s3: ${filePath}`);

      return data;
    } catch (err) {
      this.logError(err as Error, 'load');
      throw err;
    }
  }

  private async save(filePath: string, data: Record<string, any>) {
    try {
      this.log.trace(`Uploading file to s3: ${filePath}`);
      const options = {
        Bucket: this.config.bucketName,
        Key: filePath
      };
      const createCMD = new CreateMultipartUploadCommand(options);

      const createRes = await this.client.send(createCMD);

      const uploadCMD = new UploadPartCommand({
        ...options,
        Body: JSON.stringify(data, null, 2),
        PartNumber: 1,
        UploadId: createRes.UploadId
      });

      const uploadRes = await this.client.send(uploadCMD);

      const completeCMD = new CompleteMultipartUploadCommand({
        ...options,
        UploadId: createRes.UploadId,
        MultipartUpload: {
          Parts: [{ ETag: uploadRes.ETag, PartNumber: 1 }]
        }
      });

      await this.client.send(completeCMD);

      this.log.trace(`Uploaded file to s3: ${filePath}`);
    } catch (err) {
      this.logError(err as Error, 'saving');
      throw new Error(`Failed to upload file to s3: ${(err as Error).message}\n${(err as Error).stack}`);
    }
  }

  private async delete(filePath: string) {
    try {
      this.log.trace(`Removing file from s3: ${filePath}`);

      const command = new DeleteObjectCommand({
        Bucket: this.config.bucketName,
        Key: filePath
      });

      await this.client.send(command);
      this.log.trace(`Removed file from s3: ${filePath}`);
    } catch (err) {
      this.logError(err as Error, 'delete');
      throw new Error('Failed to remove file from s3');
    }
  }

  private logError(err: Error, action: string) {
    const trace = err.stack;
    let message = err.message;
    if (err instanceof S3ServiceException) {
      message = `${err.message}\nName: ${err.name}`;
    }
    this.log.error(`S3 ${action} error`, message, trace);
  }
}
