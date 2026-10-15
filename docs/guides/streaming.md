# Streaming Responses

Streaming is not available through LOFT's public API yet. `loft.chat.generate()` returns the complete response once the LLM has finished.

The OpenAI, Anthropic and Gemini strategies implement `generateStream()`, but LOFT does not expose a streaming chat call, and the streaming and queued execution modes in the codebase are experimental and not exported for use. Their symbols are marked `@experimental` and may change or be removed in any release.

To show progress to users today, call `loft.chat.generate()` and send the result when it arrives, as the [express-basic](../../examples/express-basic/) and [express-history](../../examples/express-history/) examples do.
