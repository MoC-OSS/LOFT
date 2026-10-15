---
'@moc-global/loft': patch
'@moc-global/loft-definitions': patch
'@moc-global/loft-anthropic-strategy': patch
'@moc-global/loft-openai-strategy': patch
'@moc-global/loft-gemini-strategy': patch
'@moc-global/loft-llm-call-manager': patch
'@moc-global/loft-queue-sqs-strategy': patch
'@moc-global/loft-chat-history-pg-repository': patch
'@moc-global/loft-session-pg-repository': patch
---

Fix parallel tool calls, tool errors and silent failures.

- Anthropic: the results of parallel tool calls go back in one user message, so the second and later results are no longer dropped. A failed tool result is sent with `is_error`.
- OpenAI: each tool result becomes its own `tool` message, and a result without text is sent as empty text instead of being dropped.
- Gemini: a failed tool result is sent under the `error` key.
- Tool messages from parallel calls are saved to chat history: the integrity check counts tool calls and tool results, not messages.
- MCP: the text of a tool that reports `isError` reaches the model, and an empty successful result is a success with empty content.
- Chat history rejects a message whose `sessionId` differs from the session it is added to.
- `LlmManager.getPrompt(ctx, promptName, llmName)` now takes its arguments in that order, and `ManifestManager.getPrompt` reads `prompts[promptName][llmName]`. `ctx.getPrompt` already worked; code that called `LlmManager.getPrompt` directly must swap its last two arguments.
- `SQSStrategy.publish` waits for the send and rejects when it fails. A failed queued task is logged instead of crashing the process with an unhandled rejection.
- `LoftConstructor.validateManifest()` returns the promise of the manifest check.
- The migration CLIs exit with code 1 when a migration fails.
- Postgres migrations use the `schemaName` passed to `runSessionPgMigrations` and `runChatHistoryPgMigrations` instead of reading `DATABASE_*_SCHEMA_NAME` and a `.env` file. Behaviour change: the schema name must be lower-case letters, digits and underscores (at most 63), and other names are rejected before anything runs. Mixed-case or hyphenated names already failed in the chat history migrations, which pasted the name into the SQL unquoted. A missing schema now throws instead of exiting the process. The migration CLIs still read the schema name from their env file.
- Both Postgres packages declare `dotenv`, which their migration CLI loads.
