---
'@moc-global/loft-anthropic-strategy': patch
---

Let a Focus turn start without a message with Claude.

With a Focus active, `generate()` runs without messages, and the Focus prompt opens the conversation. The Anthropic strategy moves system messages into `system`, so such a turn sent `messages: []`, and Claude rejected it with "messages: at least one message is required"; a Focus turn after the assistant's answer was rejected too, because current Claude models need a conversation that ends with the user. The strategy now adds a short user turn to the request, which is not saved to the chat history: "Start." when there is no message, and "Continue." when a Focus turn follows the assistant's answer. Without a Focus, a request that ends with an assistant message is sent as it is. OpenAI and Gemini needed no change.
