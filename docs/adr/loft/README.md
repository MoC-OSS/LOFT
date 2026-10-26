# LOFT core — Architecture Decision Records

Decisions about the core packages: `@moc-global/loft`, `@moc-global/loft-definitions`, `@moc-global/loft-llm-call-manager` and the provider strategies.

## ADR Index

| ADR | Decision | Status |
|-----|----------|--------|
| [001](001-chat-streaming.md) | Chat Streaming — Per-call events on `generate()`, providers stream inside their existing call | Proposed |

## Key Source Files

- `packages/loft-definitions/src/shared/components/ChatStreamEvent.ts` — Chat events and stream options
- `packages/loft-definitions/src/strategies/llm/LlmStreamEvent.ts` — Provider events and the sink
- `packages/loft/src/workflows/chat/streaming/` — The per-call emitter
- `packages/loft-llm-call-manager/src/GenerateManager.ts` — Queue, reservation, retries and stream timeouts

The [loft-agents ADRs](../loft-agents/README.md) cover the multi-agent layer.
