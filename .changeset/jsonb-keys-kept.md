---
'@moc-global/loft-chat-history-pg-repository': patch
'@moc-global/loft-session-pg-repository': patch
---

Return the keys inside message content and `ctx` as they were saved.

The repositories convert column names from snake_case to camelCase, and the conversion also reached the keys inside the jsonb columns. Saved data came back changed: tool call arguments such as `party_size` came back as `partySize`, `_meta` as `_Meta`, and a session `ctx` key such as `user_id` as `userId`. Only column names are converted now. Code that reads such keys from saved messages or sessions in their camelCase form must use the names it saved.
