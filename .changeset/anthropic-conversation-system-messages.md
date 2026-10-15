---
'@moc-global/loft-anthropic-strategy': patch
---

Send the conversation's system messages to Claude.

Anthropic takes one system prompt and no system messages in the conversation, and the strategy dropped them. So the Focus instructions and the context that `@moc-global/loft-agents` passes from earlier agents never reached Claude, and agents that read earlier results answered without them. The strategy now appends each system message of the conversation, in order, to the system prompt from the manifest.
