---
'@moc-global/loft-chat-history-pg-repository': minor
'@moc-global/loft-session-pg-repository': minor
---

Return the keys inside message content, `ctx` and Focus values as they were saved.

The repositories convert column names from snake_case to camelCase, and the conversion also reached the keys inside the jsonb columns. Saved data came back changed: tool call arguments such as `party_size` came back as `partySize`, `_meta` as `_Meta`, a session `ctx` key such as `user_id` as `userId`, and the keys of an object stored as a Focus field value were converted too, unlike in `InMemoryFocusStateStore`. Only column names are converted now. Code that reads such keys from saved messages or sessions in their camelCase form must use the names it saved.
