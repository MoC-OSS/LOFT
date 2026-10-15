---
'@moc-global/loft': patch
'@moc-global/loft-definitions': patch
'@moc-global/loft-anthropic-strategy': patch
'@moc-global/loft-gemini-strategy': patch
'@moc-global/loft-openai-strategy': patch
'@moc-global/loft-chat-history-pg-repository': patch
'@moc-global/loft-session-pg-repository': patch
'@moc-global/loft-aws-s3-repository': patch
'@moc-global/loft-queue-sqs-strategy': patch
---

Update dependencies to fix security advisories.

- `@modelcontextprotocol/sdk`: `^1.26.0` -> `^1.31.0`
- `axios`: `^1.13.5` -> `^1.20.0`
- `fast-copy`: `^3.0.2` -> `^3.1.0`
- `kysely`: `^0.27.3` -> `^0.28.17`
- `@aws-sdk/client-s3` and `@aws-sdk/client-sqs`: -> `^3.1140.0` (pulls a patched `fast-xml-parser`)
