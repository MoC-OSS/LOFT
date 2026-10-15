---
'@moc-global/loft-definitions': minor
'@moc-global/loft': minor
'@moc-global/loft-agents': minor
'@moc-global/loft-llm-call-manager': minor
'@moc-global/loft-anthropic-strategy': patch
'@moc-global/loft-openai-strategy': patch
'@moc-global/loft-gemini-strategy': patch
---

Cancel timed-out agent calls and fix Focus completion.

- Cancellation: `generate()` accepts an optional `signal` (AbortSignal). It is passed through the LLM manager and call manager to the Anthropic, OpenAI, Azure OpenAI and Gemini SDK calls, and the tool loop stops once the signal aborts. Aborted calls are not retried.
- `loft-agents`: a node timeout now aborts the node's LLM call before any retry. `Agent.Node.run()` receives `options.signal`, `Orchestrator.run()` and `runFrom()` accept `{ signal }` to cancel a whole run, and retries stop once the run is cancelled.
- `loft-agents`: `LoftAgentNode` takes a `focusName` option naming the registered Focus it collects. It no longer uses its node name as the Focus name; without `focusName` the session's Focus applies.
- Focus: a completed Focus returns its values once in `focusStatus.filled` and then clears them from the focus state store, so it does not complete again with stale data.
- Focus: completing a per-call Focus no longer deactivates a different session-level Focus.
- Focus: collected values and shared context are written into prompts as escaped JSON in delimited blocks (`toPromptData`), with Focus string values capped at 500 characters, so user input cannot add prompt instructions.
