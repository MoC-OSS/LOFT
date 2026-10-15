---
'@moc-global/loft': patch
---

Send the text of `ctx.aiTask(llmName, manifestName, text)` as a user message.

It was sent as a system message. The Anthropic strategy sends only the manifest's system message and skips system messages in the conversation, so an AI task with text input reached Anthropic with no message at all, and the request failed. OpenAI and Gemini now also receive the text as a user message. AI tasks called with an array of messages are unchanged.
