---
'@moc-global/loft': patch
'@moc-global/loft-definitions': patch
---

Errors keep their cause instead of losing it.

- `FsRepository` throws an `Error` with the file system error as its `cause`, not a string, and no longer logs it first; `ManifestManager` logs it once.
- `HttpCallManagerStrategy` keeps the last failure as the `cause` of "CallManager doesn't work" and "stream call doesn't work".
