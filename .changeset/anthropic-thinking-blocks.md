---
'@moc-global/loft-anthropic-strategy': patch
---

Keep Claude's thinking out of the answer and send it back during a tool loop.

The strategy dropped `thinking` blocks and added each `redacted_thinking` block to the answer as the text "[Redacted Thinking]", which then went back to Claude as part of the conversation. Thinking is now left out of the message content, so it is neither returned nor saved. When Claude thinks before calling tools, the strategy keeps the thinking blocks in memory for the tool loop and sends them back at the start of that assistant message; if they are no longer there, the request goes without them, which Anthropic accepts.
