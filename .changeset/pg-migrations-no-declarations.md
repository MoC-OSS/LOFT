---
'@moc-global/loft-session-pg-repository': patch
'@moc-global/loft-chat-history-pg-repository': patch
---

Stop shipping type declarations for the migration files and the migration CLI. Nothing in the public API refers to them, and they referred to an unpublished package. The migrations themselves still ship and run as before.
