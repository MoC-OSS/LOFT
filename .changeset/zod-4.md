---
'@moc-global/loft': major
'@moc-global/loft-definitions': major
'@moc-global/loft-openai-strategy': major
'@moc-global/loft-anthropic-strategy': major
'@moc-global/loft-gemini-strategy': major
'@moc-global/loft-session-pg-repository': major
'@moc-global/loft-chat-history-pg-repository': major
---

Move from zod 3 to zod 4. The `zod` peer dependency is now `^4.6.6`, the first version without [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), a memory exhaustion while validating large arrays that affects every zod 3 release. zod 3 is no longer supported.

To upgrade:

- Install zod 4: `npm install zod@^4.6.6`.
- Build the schemas you pass to LOFT with zod 4, such as the one given to `useLlmManifestSchema()` or returned by a custom strategy's `generateRequestValidationSchema()`.
- Code that uses the schemas LOFT exports (`Schema.*`) with zod 3 APIs needs the zod 4 changes, see the [zod 4 migration guide](https://zod.dev/v4/changelog). Validation error messages read differently, for example `Invalid input: expected string, received number`.
- `@moc-global/loft-openai-strategy` needs openai 7 (`^7.34.0`). openai 4 is no longer supported: it has had no release since May 2025, and it declares zod 3 as a peer, so npm refuses to install it next to zod 4. See the [openai-node migration guide](https://github.com/openai/openai-node/blob/main/MIGRATION.md) for the changes between the SDK majors.
