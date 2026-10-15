---
'@moc-global/loft-anthropic-strategy': patch
---

Keep Claude's thinking out of the answer and send it back during a tool loop.

The strategy dropped `thinking` blocks and added each `redacted_thinking` block to the answer as the text "[Redacted Thinking]", which then went back to Claude as part of the conversation. Thinking is now left out of the answer; when Claude thinks before calling tools, the thinking blocks are kept in the `_meta` of the first tool call and sent back at the start of that assistant message for the rest of the tool loop, as the Messages API expects.
