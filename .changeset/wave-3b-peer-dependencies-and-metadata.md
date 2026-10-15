---
'@moc-global/loft': minor
'@moc-global/loft-agents': minor
'@moc-global/loft-definitions': minor
'@moc-global/loft-anthropic-strategy': minor
'@moc-global/loft-openai-strategy': minor
'@moc-global/loft-gemini-strategy': minor
'@moc-global/loft-llm-call-manager': minor
'@moc-global/loft-queue-sqs-strategy': minor
'@moc-global/loft-aws-s3-repository': minor
'@moc-global/loft-gcp-storage-repository': minor
'@moc-global/loft-azure-blob-storage-repository': minor
'@moc-global/loft-chat-history-pg-repository': minor
'@moc-global/loft-session-pg-repository': minor
---

Declare the libraries LOFT shares with your code as peer dependencies, and fill in the package metadata.

- inversify, reflect-metadata, zod, the MCP SDK, `@moc-global/loft-definitions` (and `@moc-global/loft` for `loft-agents`) and the SDKs that appear in the public types (`openai`, `@anthropic-ai/sdk`, `@google/genai`, `@aws-sdk/client-sqs`) are peer dependencies instead of dependencies, so your project and LOFT use one copy of each. A custom constructor written against your own inversify now compiles. LOFT needs inversify 6 and zod 3. npm 7 or later and pnpm install missing peers on their own; with Yarn, add them to your dependencies.
- `langfuse` is an optional peer dependency of `@moc-global/loft`, loaded only when a `LangfuseTracer` is created. If you use `LangfuseTracer`, install `langfuse` yourself; without it, the constructor throws an error that says so.
- zod is no longer pinned to exactly 3.25.67; any zod 3 from 3.25.67 on works.
- Every package declares the MIT license, a description, keywords, homepage, issue tracker and the `MoC-OSS/LOFT` repository with its directory.
