---
'@moc-global/loft-chat-history-pg-repository': patch
---

Rolling back migration `1.2.0` (`loft-chat-history-pg-migrate down`) works again. PostgreSQL rejected its `down` with "cannot use subquery in transform expression". `content` now gets the text of the first text part without JSON quotes, and a message without text (a tool call, an image) gets an empty string. Other parts are dropped, since the column holds text only.
