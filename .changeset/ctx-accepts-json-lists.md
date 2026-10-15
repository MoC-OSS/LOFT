---
'@moc-global/loft-definitions': patch
---

Accept lists and `null` in `ctx`.

The `ctx` of sessions and messages accepted only strings, numbers, booleans and nested objects, so a `ctx` holding a list or `null` failed validation with "Expected an unknown object". This broke `@moc-global/loft-agents` runs in which a Focus completed inside the run: the next node received the Focus status, whose `missing` field is a list, and rejected it. `ctx` now accepts any JSON value inside the object.
