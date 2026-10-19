---
'@moc-global/loft-definitions': minor
'@moc-global/loft': minor
'@moc-global/loft-chat-history-pg-repository': minor
---

`ChatConfig.historyLimit` bounds how much history a request loads. A request then loads only that many of the latest messages of the session, still in chronological order, instead of the whole history; the default stays all of it. A limited history does not start with tool results whose tool call was cut off.

- `Repository.ChatHistory.getMessages()` takes an optional `{ limit }`. The PostgreSQL repository reads only the latest messages; a custom repository that ignores it still works, as the chat history manager keeps the latest messages itself.
- `getChatHistory()` still returns the whole history.
