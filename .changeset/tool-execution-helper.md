---
'@moc-global/loft': patch
---

`LlmManager.generate` now runs every tool call through one internal helper; this is an internal refactor with no change in behaviour.
