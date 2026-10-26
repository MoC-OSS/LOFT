---
'@moc-global/loft': patch
---

The `generate()` trace and the `addMessages()` log no longer repeat the raw messages of a request:

- The trace's `metadata.requestOptions` no longer has the `directMessages` and `augmentedContext` fields: it holds `directMessagesCount` and `augmentedContextCount` instead. If a dashboard or a trace query reads the removed fields, read the trace's `input`, which holds the request after the Input middleware (set when the call succeeds). Middleware spans still record the payload each middleware receives.
- `addMessages()` logs the number of messages at trace level instead of the messages.
