# @moc-global/loft-kysely-pg-migrator

## 1.0.4

### Patch Changes

- c949af5: Simplify Logger API (remove DI injection, buffering), delete unused SMG code, fix MCP SDK vulnerability (upgrade to 1.25.0, pin Zod to 3.25.67)

## 1.0.3

### Patch Changes

- e2638a1: Fix Anthropic strategy to only include citations in ctx when defined

## 1.0.2

### Patch Changes

- 812b01c: Added Jest ESM troubleshooting docs for Langfuse dynamic import error and made ctx field in Message schema default to {}.

## 1.0.1

### Patch Changes

- 5157af8: Add comprehensive Langfuse tracing, refactor ManifestManager to instance-based caching with recovery mechanisms (BREAKING: async LLM registration), fix parallel test execution with OS-based port allocation, remove Logger DI dependency.
- 26aff62: Add new Gemini strategy package with support for Vertex AI (GCP) and Google AI Studio authentication modes, including message adapters and MCP tool support
- bb3b08e: Fix migration path resolution and remove JSON import dependencies in database repository packages
