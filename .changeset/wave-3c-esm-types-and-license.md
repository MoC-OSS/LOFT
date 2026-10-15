---
'@moc-global/loft': patch
'@moc-global/loft-agents': patch
'@moc-global/loft-definitions': patch
'@moc-global/loft-anthropic-strategy': patch
'@moc-global/loft-openai-strategy': patch
'@moc-global/loft-gemini-strategy': patch
'@moc-global/loft-llm-call-manager': patch
'@moc-global/loft-queue-sqs-strategy': patch
'@moc-global/loft-aws-s3-repository': patch
'@moc-global/loft-gcp-storage-repository': patch
'@moc-global/loft-azure-blob-storage-repository': patch
'@moc-global/loft-chat-history-pg-repository': patch
'@moc-global/loft-session-pg-repository': patch
---

Ship ES module types and the MIT license file.

- Code that imports a package now gets ES module type declarations (`.d.mts`) that match the `.mjs` build; code that requires it keeps the CommonJS declarations (`.d.ts`). Before, both got the CommonJS declarations, so TypeScript with `moduleResolution: node16` or `nodenext` typed ES module imports as CommonJS. `package.json` is exported too.
- Every package ships the MIT `LICENSE`. `@moc-global/loft-definitions` also ships a `NOTICE` for the types it copies from the MCP TypeScript SDK (MIT, Anthropic, PBC).
