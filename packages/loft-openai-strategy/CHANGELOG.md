# @moc-global/loft-openai-strategy

## 1.2.13

### Patch Changes

- 7747867: Security fix for `AzureOpenAiCallStrategy`: when `endpoint` was not set, the client fell back to the placeholder `https://your-azure-openai-resource.com`. A third party owns that domain, so requests and their API key or Azure AD token could reach it. Without `endpoint`, the client now reads `AZURE_OPENAI_ENDPOINT` and throws if that is unset too. If you ran without `endpoint`, rotate your Azure OpenAI keys.

  Also fixes two ignored settings:
  - A configured `apiVersion` was replaced by a default.
  - A configured `deploymentName` was dropped, so requests went to the deployment named after the request's `model`. They now go to the configured deployment.

- 7db5371: Raise the minimum `@modelcontextprotocol/sdk` to `^1.26.0`, which fixes GHSA-345p-7cg4-v4c7: sharing an MCP server or transport instance could leak response data between clients. Loft itself uses the SDK client, so the fix matters if you share an `McpServer` or transport instance, for example through the `McpServer` and `InMemoryTransport` re-exports from `@moc-global/loft-definitions`. No API changes in Loft.
- Updated dependencies [151b683]
- Updated dependencies [7db5371]
  - @moc-global/loft-definitions@1.7.0

## 1.2.12

### Patch Changes

- c949af5: Simplify Logger API (remove DI injection, buffering), delete unused SMG code, fix MCP SDK vulnerability (upgrade to 1.25.0, pin Zod to 3.25.67)
- Updated dependencies [c949af5]
  - @moc-global/loft-definitions@1.6.3

## 1.2.11

### Patch Changes

- e2638a1: Fix Anthropic strategy to only include citations in ctx when defined
- Updated dependencies [e2638a1]
  - @moc-global/loft-definitions@1.6.2

## 1.2.10

### Patch Changes

- 812b01c: Added Jest ESM troubleshooting docs for Langfuse dynamic import error and made ctx field in Message schema default to {}.
- Updated dependencies [812b01c]
  - @moc-global/loft-definitions@1.6.1

## 1.2.9

### Patch Changes

- 5157af8: Add comprehensive Langfuse tracing, refactor ManifestManager to instance-based caching with recovery mechanisms (BREAKING: async LLM registration), fix parallel test execution with OS-based port allocation, remove Logger DI dependency.
- 26aff62: Add new Gemini strategy package with support for Vertex AI (GCP) and Google AI Studio authentication modes, including message adapters and MCP tool support
- Updated dependencies [b4b2015]
- Updated dependencies [5157af8]
- Updated dependencies [26aff62]
  - @moc-global/loft-definitions@1.6.0

## 1.2.8

### Patch Changes

- Updated dependencies [a06ad5a]
- Updated dependencies [9e62e13]
- Updated dependencies [19de13d]
- Updated dependencies [17ee776]
- Updated dependencies [7620009]
  - @moc-global/loft-definitions@1.5.0

## 1.2.7

### Patch Changes

- Updated dependencies [ca1ef1d]
  - @moc-global/loft-definitions@1.4.8

## 1.2.6

### Patch Changes

- 608d096: moved @moc-global/loft-base-tsconfig to monorepo pnpm root devDependencies
- Updated dependencies [608d096]
  - @moc-global/loft-definitions@1.4.7

## 1.2.5

### Patch Changes

- 4b059fd: migrated monorepo to PNPM, updated packages, upgraded LOFT Multi Part Content structure, updated MPC SDK and Structures, fixed types in LLM Strategies, added tool for sync versions across all packages, fixed a lot of monorepo problems, tests etc...
- 05efbbd: migrate from base-tsconfig to loft-base-tsconfig across all packages and include loft-base-tsconfig package to publish
- Updated dependencies [4b059fd]
- Updated dependencies [05efbbd]
  - @moc-global/loft-definitions@1.4.6

## 1.2.4

### Patch Changes

- 4b059fd: migrated monorepo to PNPM, updated packages, upgraded LOFT Multi Part Content structure, updated MPC SDK and Structures, fixed types in LLM Strategies, added tool for sync versions across all packages, fixed a lot of monorepo problems, tests etc...
- Updated dependencies [4b059fd]
  - @moc-global/loft-definitions@1.4.5

## 1.2.3

### Patch Changes

- d02d0a5: Initial release
- Updated dependencies [d02d0a5]
  - @moc-global/loft-definitions@1.4.4
