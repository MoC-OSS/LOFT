---
'@moc-global/loft-session-pg-repository': major
'@moc-global/loft-chat-history-pg-repository': major
'@moc-global/loft-llm-call-manager': major
---

Require Node.js 22.12 or later, for Kysely 0.29 and p-queue 10.

The PostgreSQL repositories move from Kysely 0.28 to 0.29, and the call manager from p-queue 6 to 10. Both ship only ES modules, and the CommonJS build loads them with `require()`, which Node.js supports without a flag from 22.12. To upgrade, run Node.js 22.12 or later. The migrations, the migration CLIs and the database schema are unchanged. If you create the dialect with your own `kysely` package rather than the re-exported `SessionPostgresDialect` and `ChatHistoryPostgresDialect`, update it to 0.29 as well.

`loft-llm-call-manager`: `GenerateCallManager.taskPQueue` is now typed as the new `TaskQueue` interface (`size`, `sizeBy()` and `add()`) instead of the p-queue class, because p-queue 10 publishes its types only through `exports`, which `moduleResolution: node` does not read. Code that calls other p-queue methods on `taskPQueue` needs a cast.
