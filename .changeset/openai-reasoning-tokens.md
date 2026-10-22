---
'@moc-global/loft-openai-strategy': patch
---

Report reasoning tokens for OpenAI and Azure OpenAI reasoning models. The count is now read from `usage.completion_tokens_details.reasoning_tokens`, where the API puts it, so `reasoningTokens` in the unified usage is no longer always undefined.
