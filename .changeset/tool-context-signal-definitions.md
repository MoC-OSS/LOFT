---
'@moc-global/loft-definitions': minor
---

The tool handler type takes an optional second argument, `context` (`Chat.AdditionalToolContext`), with the `generate()` abort signal (`context.signal`) and an `emit(name, data)` function. `emit` is experimental. The handler is declared method-style, so handlers that take only the arguments, or that declare a required `context`, still type-check.
