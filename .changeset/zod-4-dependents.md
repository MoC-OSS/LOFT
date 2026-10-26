---
'@moc-global/loft-agents': major
'@moc-global/loft-azure-blob-storage-repository': major
'@moc-global/loft-gcp-storage-repository': major
'@moc-global/loft-aws-s3-repository': major
'@moc-global/loft-llm-call-manager': major
'@moc-global/loft-queue-sqs-strategy': major
---

The `@moc-global/loft-definitions` peer dependency moves to its next major version, which needs zod 4 (`^4.6.6`) instead of zod 3. Upgrade `@moc-global/loft-definitions` and install zod 4 together with this release; this package's own API is unchanged.
