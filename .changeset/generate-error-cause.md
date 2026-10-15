---
'@moc-global/loft': patch
'@moc-global/loft-definitions': patch
---

`GenerateError` carries the original error as `cause`.

When `generate()` failed on an error that was not already a `GenerateError`, such as a provider error or a failing middleware, the wrapper left `cause` empty and put the original error only in `details`, so the documented `error.cause` and the `Caused by:` stack were missing. `cause` now holds the original error, and `details` still does. The message is the original error's message, without the doubled `Error:` prefix.

The stack of `GenerateError`, `ShutdownError` and the other `ChatError` subclasses now ends with the cause's stack after `Caused by:`, as documented; each subclass captured its stack again after `ChatError` had added the cause, which removed it.
