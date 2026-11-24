# Changelog

All notable changes to the loft-integration plugin are documented in this file.

## [1.5.0] - 2026-11-23

### Changed
- References, Key Facts, the analyzer checklist and evals re-verified against loft 3.0.0 (was 2.7.3); the version anchor is now 3.0.0
- Peer dependencies: zod `^4.6.6` (zod 3 unsupported; the zod 3.25.67 pin is removed), inversify 6, openai 7, Node.js 22.12+ for the PostgreSQL repositories and the call manager
- Streaming is documented as `chat.generate({ onEvent })` (experimental); `StreamLoftConstructor`/`QueuedLoftConstructor` references removed, strategy `generateStream()` marked deprecated
- AfterGenerate middleware payload is `Chat.GenerateResultMessages` (usage at `payload.llmResponse.usage`), with the optional `transformsOutput` option
- Shutdown uses `loft.shutdown()`; `gracefulShutdown()` is deprecated
- CreateMessage: all fields except `id` are required by the TypeScript type (the schema defaults for `content`, `ctx` and `llmIgnore` apply only at runtime parsing); manifests require `llmManifests`, `prompts` and `aiTasks`
- Gotcha 1/2: `Reflect.getMetadata is not a function` is attributed to `reflect-metadata` not being loaded, not to a missing `emitDecoratorMetadata`
- Middleware `chain.next()` is synchronous; `loft.shutdown()` waits for in-flight work instead of stopping it
- Docs structure and examples list in SKILL.md include agents, tools, guard middleware and the newer examples
- `package-map.md`: 13 published packages with current versions, new Peer Dependencies section, `loft-agents` and `loft-middleware` added, dependency graph corrected
- `setup-patterns.md`: new Install section; fixed Gemini, Azure OpenAI, Express multi-turn, NestJS and serverless snippets; migration CLI and programmatic migrations
- `interfaces-quick-ref.md`: new Streaming Events and Tools sections; chat API, entities, middleware, strategy, repository, constructor and DI symbol signatures updated
- `common-gotchas.md`: 25 gotchas (added peer dependencies and the AfterGenerate payload type; removed the zod pin; updated streaming, MCP, migrations and shutdown)

## [1.4.0] - 2026-11-23

### Changed
- Moved to the public `MoC-OSS/LOFT` repository, which is now its own Claude Code marketplace (`loft`). Install with `claude plugin marketplace add MoC-OSS/LOFT` and `claude plugin install loft-integration@loft`
- License changed from "MOCG Internal Use Only" to MIT; author is now Master of Code Global
- Repository slug updated to `MoC-OSS/LOFT` in SKILL.md and loft-researcher.md; Tier 2 docs access no longer needs private-repo access and falls back to `curl` on raw files when `gh` is missing or rate-limited
- `plugin.json` gains `homepage`, `repository` and `keywords`; the version now lives only in `plugin.json` (the marketplace entry no longer repeats it)
- README rewritten for public users: install and update commands, optional prerequisites, supported LOFT version

## [1.3.0] - 2026-10-04

### Changed
- Skill and agents reference plugin-root resources via `${CLAUDE_PLUGIN_ROOT}`; agents are dispatched as `loft-integration:loft-analyzer` / `loft-integration:loft-researcher` instead of pasting agent files into a general-purpose agent
- Description now states what the skill does before when to use it; removed the catch-all "when in doubt" trigger and `license: MIT` frontmatter
- Added a version anchor (loft 2.7.3); dated phrasing in references and Key Facts is now version-anchored
- Repository slug updated to `moc-global/loft-mono`
- Delegation rules stated once; Setup validation now runs `npx tsc --noEmit` and re-runs until clean; loft-researcher points to SKILL.md for the docs structure
- Added `## Contents` to the four reference files
- `evals/` and `trigger-eval.json` are now tracked (only `evals/workspace/` and `loft-integration-workspace/` are ignored)

## [1.2.0] - 2026-04-02

### Changed
- Restructured Tier 2 documentation access to start from `docs/` directory instead of repo root — reflects that docs/ now exists with full structured content (SKILL.md, loft-researcher.md)
- Removed `CLAUDE.md` as a documentation source — it is internal Claude Code instructions, not user-facing documentation (SKILL.md, loft-researcher.md)
- Updated Guide flow topic table: Architecture/concepts now points to `docs/concepts/architecture.md`

### Fixed
- `getChatHistory()` return type in interfaces-quick-ref.md: was `Promise<Message[]>`, corrected to `Promise<QueryByArrayOfObjects<Message>>` (extends Array with query methods)

## [1.1.0] - 2026-04-02

### Added
- `loft-researcher` subagent (`agents/loft-researcher.md`) for delegated documentation research
- Delegation Strategy section in SKILL.md with conditional dispatch rules
- Inline vs. subagent decision logic for Setup, Modify, and Guide flows

### Changed
- Setup flow now delegates multi-reference research to `loft-researcher` subagent, keeping main session context clean
- Modify flow distinguishes single-concern (inline) vs. multi-concern (delegated) changes
- Guide flow includes delegation decision based on number of sources needed
- Clarified package manager adaptability in Setup flow install commands

## [1.0.0] - 2026-03-28

### Added
- Initial plugin release
- SKILL.md with four operational modes: Setup, Modify, Guide, Analyze
- `loft-analyzer` subagent for deep codebase analysis
- Three-tier documentation access strategy (embedded references, GitHub API, installed packages)
- Embedded reference files: `package-map.md`, `setup-patterns.md`, `common-gotchas.md`, `interfaces-quick-ref.md`
- 10 key facts for common LOFT pitfalls
- Skill description optimized for triggering on `@moc-global/*` imports and LOFT-related queries
