# @moc-global/loft-azure-blob-storage-repository

Keeps the manifests of [LOFT](https://github.com/MoC-OSS/LOFT) in an Azure Blob Storage container. Manifests hold the system prompts and model settings; with them in a container you change a prompt by uploading a file, without a redeploy. LOFT reloads the manifest when its cache expires.

## Install

```bash
npm install @moc-global/loft-azure-blob-storage-repository
```

Its peers, `@moc-global/loft-definitions`, `inversify` 6 and `reflect-metadata`, are already in a LOFT application. It uses `@azure/storage-blob`.

## Usage

Pass an `AzureBlobStorageRepositoryConstructor` to `ManifestManagerConstructor` in place of the local `FsRepositoryConstructor`. The paths are blob names in the container:

```typescript
import { ManifestManagerConstructor } from '@moc-global/loft';
import { AzureBlobStorageRepositoryConstructor } from '@moc-global/loft-azure-blob-storage-repository';

export const manifestManagerConstructor = new ManifestManagerConstructor(
  new AzureBlobStorageRepositoryConstructor({
    containerName: 'loft-manifests',
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING!
  }),
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
| `containerName` | yes | The container |
| `connectionString` | yes | The storage account's connection string, for example `DefaultEndpointsProtocol=https;AccountName=<account>;AccountKey=<key>;EndpointSuffix=core.windows.net` |

The connection string is the only way to sign in; Microsoft Entra ID is not supported yet. The account needs to read the manifest blob and create blobs under the error path: when a manifest fails validation, LOFT writes the error there under a time-stamped name. The health check checks that the container exists.

## Documentation

- [Manifests](https://github.com/MoC-OSS/LOFT/blob/main/docs/guides/manifests.md), including the manifest format and caching

## License

[MIT](./LICENSE)
