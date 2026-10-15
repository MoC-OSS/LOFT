# @moc-global/loft-aws-s3-repository

Keeps the manifests of [LOFT](https://github.com/MoC-OSS/LOFT) in an AWS S3 bucket. Manifests hold the system prompts and model settings; with them in S3 you change a prompt by uploading a file, without a redeploy. LOFT reloads the manifest when its cache expires.

## Install

```bash
npm install @moc-global/loft-aws-s3-repository
```

Its peers, `@moc-global/loft-definitions`, `inversify` 6 and `reflect-metadata`, are already in a LOFT application. It uses `@aws-sdk/client-s3`.

## Usage

Pass an `AwsS3RepositoryConstructor` to `ManifestManagerConstructor` in place of the local `FsRepositoryConstructor`. The paths are object keys in the bucket:

```typescript
import { ManifestManagerConstructor } from '@moc-global/loft';
import { AwsS3RepositoryConstructor } from '@moc-global/loft-aws-s3-repository';

export const manifestManagerConstructor = new ManifestManagerConstructor(
  new AwsS3RepositoryConstructor({ region: 'eu-west-1', bucketName: 'my-loft-manifests' }),
  {
    manifestPath: 'production/manifest.json',
    errorPath: 'production/errors/error.json',
    cacheExpirationTime: 3_600_000
  }
);
```

Then pass `manifestManagerConstructor` as the second argument of `LoftConstructor`.

## Configuration

| Field | Required | What it sets |
| --- | --- | --- |
| `region` | yes | The bucket's AWS region |
| `bucketName` | yes | The bucket |
| `endpoint` | no | Another S3-compatible endpoint, such as MinIO or LocalStack |
| `forcePathStyle` | no | Path-style URLs, which most S3-compatible servers need |

Credentials come from the AWS SDK's default chain: environment variables, the shared config files, or the role of the instance, task or function. They need `s3:GetObject` on the manifest key, and `s3:PutObject` on the error path: when a manifest fails validation, LOFT writes the error there under a time-stamped name. The health check lists the account's buckets, so it also needs `s3:ListAllMyBuckets`.

## Documentation

- [Manifests](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/manifests.md), including the manifest format and caching

## License

[MIT](./LICENSE)
