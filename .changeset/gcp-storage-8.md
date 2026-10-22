---
'@moc-global/loft-gcp-storage-repository': patch
---

Update `@google-cloud/storage` from 7 to 8. Version 8 needs Node.js 22 or later, which this package already requires, and it no longer pulls in `uuid` through `teeny-request`, which removes the `uuid` advisory from the dependency tree. `GcpStorageRepositoryConstructor` and its options are unchanged.
