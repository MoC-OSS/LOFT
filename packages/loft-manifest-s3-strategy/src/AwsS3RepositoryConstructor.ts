import 'reflect-metadata';

import { Interface, Repository } from '@moc-global/loft-definitions';
import { Container } from 'inversify';

import { AWS_S3_DI_TYPES } from './AwsS3DITypes';
import { AwsS3Repository, AwsS3RepositoryConfig } from './AwsS3Repository';

export class AwsS3RepositoryConstructor implements Interface.BaseComponentConstructor<Repository.ObjectStorage> {
  protected awsS3RepositoryContainer: Container;

  constructor(private readonly config: AwsS3RepositoryConfig) {
    this.awsS3RepositoryContainer = new Container();
  }

  initializeContainer(mainContainer: Container) {
    this.awsS3RepositoryContainer.parent = mainContainer;

    this.awsS3RepositoryContainer
      .bind<AwsS3RepositoryConfig>(AWS_S3_DI_TYPES.AwsS3RepositoryConfig)
      .toConstantValue(this.config);
    this.awsS3RepositoryContainer.bind<Repository.ObjectStorage>(AWS_S3_DI_TYPES.AwsS3Repository).to(AwsS3Repository);
  }

  getInstance(): Repository.ObjectStorage {
    return this.awsS3RepositoryContainer.get<Repository.ObjectStorage>(AWS_S3_DI_TYPES.AwsS3Repository);
  }
}
