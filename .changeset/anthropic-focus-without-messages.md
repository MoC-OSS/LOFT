---
'@moc-global/loft-anthropic-strategy': patch
---

Let a Focus turn run without a user message with Claude.

Since 1.1.0 the strategy sends the conversation's system messages, the Focus prompt among them, in `system`. A Focus turn that `generate()` runs without messages therefore sent `messages: []`, which Claude rejects ("at least one message is required"), and a Focus turn right after the assistant's answer sent a conversation that ends with the assistant, which current Claude models reject. The strategy now adds a short user turn to the request only, not to the chat history: "Start." when there is no message, and "Continue." when a Focus turn follows the assistant's answer. Without a Focus, a conversation that ends with the assistant is sent unchanged.

The 1.1.0 notes said Claude Haiku 5.5 turns thinking off with `between_tools`. Haiku 5.5 rejects `between_tools` and takes `{ "type": "disabled" }`, while Sonnet 5.5 turns it off only with `between_tools`. The README and the manifests guide are corrected.
