---
'@moc-global/loft': patch
---

Keep each message's `ctx` when patching chat history.

`context.chatHistory.patchMessages()` lost the `ctx` of every patched message unless the patch itself set `ctx`, because the messages were copied with a spread that skips the `ctx` getter. The copy now takes each message field explicitly. This only affects applications that pass a `ChatHistoryPatcher` repository to `ChatConstructor`.
