---
'@moc-global/loft': patch
'@moc-global/loft-agents': patch
'@moc-global/loft-definitions': patch
'@moc-global/loft-anthropic-strategy': patch
'@moc-global/loft-openai-strategy': patch
'@moc-global/loft-gemini-strategy': patch
'@moc-global/loft-llm-call-manager': patch
'@moc-global/loft-queue-sqs-strategy': patch
'@moc-global/loft-aws-s3-repository': patch
'@moc-global/loft-gcp-storage-repository': patch
'@moc-global/loft-azure-blob-storage-repository': patch
'@moc-global/loft-chat-history-pg-repository': patch
'@moc-global/loft-session-pg-repository': patch
---

Fix the ES module builds, and publish only the built code.

- `loft-llm-call-manager` works when imported as an ES module: `GenerateCallManager` and `GenerateWithQueueManager` no longer throw `PQueue is not a constructor`.
- The Postgres repositories load as ES modules, and `runSessionPgMigrations` and `runChatHistoryPgMigrations` find their migrations from both builds. Their library entry no longer bundles the migration CLI (yargs, dotenv). `SessionMigrationOptions` and `ChatHistoryMigrationOptions` are exported, and `databaseSsl` is optional (default false).
- Each package is built from its `index.ts` into one bundle per format, and the tarball holds only `lib` (and `bin` for `loft-definitions`), so tests, sources and `tsconfig.json` are no longer published. `@moc-global/loft` unpacks to 1.0 MB instead of 6.5 MB. Only the package root was ever exported, so imports do not change.
- Unused runtime dependencies are removed: `axios`, `fast-copy` and `openai` from `loft`; `axios`, `uuid` and `zod-to-json-schema` from `loft-openai-strategy`; `uuid` from the Gemini, LLM call manager and Postgres packages. `zod` moves to `devDependencies` in the S3, GCP, Azure, SQS and LLM call manager packages, which use it only in tests. Code that imported one of these through LOFT must declare it itself.
