---
'@moc-global/loft': minor
'@moc-global/loft-definitions': minor
---

Type AfterGenerate middleware with the payload it receives.

`registerAfterGenerateMiddleware()` declared the payload as `Strategy.LLM.UnifiedLLMResponse`, but the middleware receives a `Chat.GenerateResultMessages` (`llmResponse`, `directMessages`, `augmentedContext`, `save()`). Code that read, for example, `payload.usage` compiled and got `undefined`; it now fails to compile and should read `payload.llmResponse.usage`. Middleware typed as `StandardMiddleware<ContextInterface, Strategy.LLM.UnifiedLLMResponse>` should change to `StandardMiddleware<ContextInterface, Chat.GenerateResultMessages>`.
