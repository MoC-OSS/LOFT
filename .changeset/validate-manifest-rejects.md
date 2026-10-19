---
'@moc-global/loft': patch
'@moc-global/loft-definitions': minor
---

`LoftConstructor.validateManifest()` now rejects when the manifests cannot be loaded or are invalid, as its docs say. It resolved in every case: it called `ManifestManager.updateCache()`, which logs a failed load and keeps the stale cache. `ManifestManager` gets a `validate()` method that reports the error. `Interface.ManifestManager` declares it as optional, and `validateManifest()` falls back to `updateCache()` for a manager without it. Request handling keeps using the stale cache as before.
