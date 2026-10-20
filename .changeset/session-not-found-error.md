---
'@moc-global/loft-definitions': minor
'@moc-global/loft-session-pg-repository': minor
'@moc-global/loft': patch
---

Add `SessionNotFoundError`, so an application can tell a missing session apart from a database or provider failure, for example to answer 404.

- `@moc-global/loft-definitions` exports it. It extends `ChatError` and has the `sessionId`, or the `externalKey` the session was looked up by. A custom `Repository.Session` should throw it from `getById()`, `getByExternalKey()`, `updateById()` and `deleteById()`.
- The PostgreSQL session repository throws it instead of a plain `Error` (or Kysely's `NoResultError` from `updateById()`). It reaches the caller unchanged from `generate()`, `addMessages()`, `getSessionById()`, `getSessionByExternalKey()`, `updateSessionSettings()` and `deleteSession()`. The message stays `Session with id <id> not found`; for an external key it now shows the key as JSON instead of `[object Object]`.
- `updateSessionSettings()` throws it too when a custom repository returns nothing for the session.
