---
'@moc-global/loft-definitions': minor
'@moc-global/loft-gemini-strategy': patch
---

Keep Gemini 3 thought signatures, so tool calls work with Gemini 3.

Gemini 3 models sign their thinking and reject a request whose earlier function calls come back without their signatures (400 "Function call is missing a thought_signature"). The strategy dropped the signatures, so every tool loop with a Gemini 3 model failed on its second request. It now keeps each signature in the `_meta` of the content part and sends it back. A turn whose function calls have no signature, such as one saved by an older LOFT version or made by another model of the session, is sent with Gemini's documented stand-in `skip_thought_signature_validator`. A `tool_call` content part takes an optional `_meta`, as the other content parts do; it stays outside `params`, which go to the MCP server. Thought summaries are no longer added to the answer text, in streaming too.
