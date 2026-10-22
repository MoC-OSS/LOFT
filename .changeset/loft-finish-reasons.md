---
'@moc-global/loft-definitions': minor
---

New `Strategy.LLM.LoftFinishReason` enum names the finish reasons LOFT sets on a response that no provider call produced: `interceptor_override` (a tool interceptor replaced the reply), `middleware_override` (BeforeGenerate middleware prevented the generation) and `max_loops_exceeded` (the tool loop reached its limit). The values are the strings LOFT already wrote to `usage.finishReason`; nothing changes for code that compares against them.
