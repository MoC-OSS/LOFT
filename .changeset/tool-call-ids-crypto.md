---
'@moc-global/loft-definitions': patch
'@moc-global/loft-openai-strategy': patch
'@moc-global/loft-chat-history-pg-repository': patch
---

Generate tool-call ids with `node:crypto` instead of `Math.random()`.

`generateToolCallId()` keeps its `{toolName}:::{20 lowercase letters}` format. The OpenAI strategy names a tool call that has no `callId` `call_<uuid>` instead of `call_<9 base-36 characters>`. Also removes a statement without effect from `ChatHistoryRepositoryConstructor.initializeContainer()` and a branch of `deepMerge()` that copied nested arrays element by element; nested arrays are still copied shallowly.
