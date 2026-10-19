---
'@moc-global/loft-definitions': patch
'@moc-global/loft': patch
---

Drop the `uuid` dependency: ids come from `node:crypto` `randomUUID`, and the `UUID` schema accepts the same values as before. `loft-definitions` updates `pino` from 8 to 10.
