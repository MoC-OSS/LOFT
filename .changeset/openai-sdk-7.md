---
'@moc-global/loft-openai-strategy': minor
---

Support `openai` 7. The peer range is now `^4.91.1 || ^7.34.0`; openai 4 still works, and openai 5 and 6 are left out because they are not tested.

A response with a custom tool call, which newer openai versions can return, now fails with an error that names the type instead of a `TypeError`; LOFT declares only function tools. `generateStream()` of `OpenAiCallStrategy` and `AzureOpenAiCallStrategy` (experimental, not reachable through the public API) calls `chat.completions.create()` with `stream: true`, which both openai versions have, instead of `beta.chat.completions.stream()`.
