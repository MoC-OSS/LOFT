# @moc-global/loft-gcp-storage-repository

Keeps the manifests of [LOFT](https://github.com/MoC-OSS/LOFT) in a Google Cloud Storage bucket. Manifests hold the system prompts and model settings; with them in a bucket you change a prompt by uploading a file, without a redeploy. LOFT reloads the manifest when its cache expires.

## Install

```bash
npm install @moc-global/loft-gcp-storage-repository
```

Its peers, `@moc-global/loft-definitions`, `inversify` 6 and `reflect-metadata`, are already in a LOFT application. It uses `@google-cloud/storage`.

## Usage

Pass a `GcpStorageRepositoryConstructor` to `ManifestManagerConstructor` in place of the local `FsRepositoryConstructor`. The paths are object names in the bucket:

```typescript
import { ManifestManagerConstructor } from '@moc-global/loft';
import { GcpStorageRepositoryConstructor } from '@moc-global/loft-gcp-storage-repository';

export const manifestManagerConstructor = new ManifestManagerConstructor(
  new GcpStorageRepositoryConstructor({ bucketName: 'my-loft-manifests', projectId: 'my-gcp-project' }),
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
| `bucketName` | yes | The bucket |
| `projectId` | no | The Google Cloud project; by default the one the credentials belong to |
| `apiEndpoint` | no | Another endpoint, such as a Cloud Storage emulator |

Credentials come from Application Default Credentials: a service account on Google Cloud, `GOOGLE_APPLICATION_CREDENTIALS`, or `gcloud auth application-default login`. They need to read the manifest object and create objects under the error path: when a manifest fails validation, LOFT writes the error there under a time-stamped name. The health check lists the project's buckets, so it also needs `storage.buckets.list`.

## Documentation

- [Manifests](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/manifests.md), including the manifest format and caching

## License

[MIT](./LICENSE)
