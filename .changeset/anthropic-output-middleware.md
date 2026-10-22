---
'@moc-global/loft-anthropic-strategy': minor
---

`AnthropicLoftStrategy` gets `hasOutputMiddleware()` (experimental), which reports whether a middleware that may change the reply text is registered. LOFT asks it when a `generate()` call passes `onEvent`: a strategy without the method would count as having such middleware and hold text back until the end. With it, text is sent as it arrives unless such a middleware is registered.

`useMiddleware(name, middleware, options?)` now passes the optional `{ transformsOutput?: boolean }` (experimental) on, so a middleware registered with `transformsOutput: false` does not hold text back. Its `middleware` parameter is now typed as an LLM response middleware instead of `any`, so a function of another shape no longer compiles.
