# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

LOFT is a TypeScript LLM orchestration framework, published as `@moc-global/*` packages. The repository is a pnpm + Turborepo monorepo that also hosts a public Claude Code plugin marketplace.

[AGENTS.md](./AGENTS.md) holds the Turborepo agent rules. [CONTRIBUTING.md](./CONTRIBUTING.md) is the source of truth for the contribution workflow; this file summarises it and adds conventions for working here.

## Repository layout

| Path | What it is |
|---|---|
| `packages/*` | The `@moc-global/*` packages (pnpm workspaces). See [Packages](#packages) |
| `integration/` | Integration test suite (`loft-integration-tests`, a workspace). Runs offline on PGlite and a scripted LLM; `*.live.test.ts` files call real providers and need the keys from `integration/.env.test.example` |
| `examples/*` | Example apps (Express, NestJS, serverless, ...). Workspaces, built and linted separately from the packages |
| `docs/` | Documentation: `getting-started`, `concepts`, `guides`, `reference`, `adr`, `interactive` and `contributing` |
| `scripts/` | Repo tooling: package, tarball, consumer and README-snippet checks (`*.mjs`) and the plugin skill linter (`lint_skills.py`) |
| `.changeset/` | Changesets config and pending changesets |
| `.claude-plugin/`, `plugins/` | The Claude Code marketplace and its plugins. See [Claude Code marketplace](#claude-code-marketplace) |
| `.github/` | CI (`ci.yml`), DCO check, release, dependency review, CODEOWNERS and templates |

Workspaces are `packages/*`, `integration` and `examples/*`. `plugins/` and `.claude-plugin/` are not workspaces.

## Packages

The directory name does not always match the npm name. Check `package.json` before assuming.

| Directory | npm name | Published |
|---|---|---|
| `loft` | `@moc-global/loft` (core) | yes |
| `loft-definitions` | `@moc-global/loft-definitions` (shared types, interfaces, DI symbols) | yes |
| `loft-agents` | `@moc-global/loft-agents` | yes |
| `loft-llm-call-manager` | `@moc-global/loft-llm-call-manager` | yes |
| `loft-openai-strategy`, `loft-anthropic-strategy`, `loft-gemini-strategy` | `@moc-global/loft-<name>` (LLM providers) | yes |
| `loft-chat-history-pg-repository`, `loft-session-pg-repository` | `@moc-global/loft-<name>` | yes |
| `loft-queue-sqs-strategy` | `@moc-global/loft-queue-sqs-strategy` | yes |
| `loft-azure-blob-repository` | `@moc-global/loft-azure-blob-storage-repository` | yes |
| `loft-manifest-gcp-storage-repository` | `@moc-global/loft-gcp-storage-repository` | yes |
| `loft-manifest-s3-strategy` | `@moc-global/loft-aws-s3-repository` | yes |
| `loft-base-tsconfig`, `loft-kysely-pg-migrator`, `loft-middleware`, `loft-pglite`, `loft-test-suite` | `@moc-global/loft-<name>` | **no** (private) |

Internal dependencies use the `workspace:*` protocol (enforced by `manypkg`).

## Setup and commands

Requires Node.js 22.12 or later and Corepack, which installs the pnpm version pinned in `package.json`. Always use `pnpm`, not `npm` or `yarn`.

```bash
corepack enable
pnpm install
pnpm build-packages          # build packages/* and integration (Turborepo)
```

Before you push, run the same checks as CI:

```bash
pnpm build-packages && pnpm typecheck && pnpm lint:check && pnpm test:unit
pnpm test:integration        # also :esm and :cjs
```

Other useful commands:

| Command | Purpose |
|---|---|
| `pnpm run --filter=<npm-name> test` | Tests for one package |
| `pnpm build:examples`, `pnpm lint:examples`, `pnpm check-types:examples` | Build, lint and typecheck the examples |
| `pnpm check:readme-snippets` | Compile every `typescript` block in the READMEs (run after the build) |
| `pnpm check:manifests`, `check:types-exports`, `check:tarballs`, `check:consumer`, `smoke:imports` | Package publishing checks |
| `pnpm versions:check` / `versions:align` | Check or fix version consistency across packages |

Turborepo behaves differently between versions. Before you change `turbo.json` or Turbo commands, follow the rules in [AGENTS.md](./AGENTS.md).

Deeper guides: [local setup](./docs/contributing/local-setup.md), [build system](./docs/contributing/build-system.md), [testing](./docs/contributing/testing.md), [code style](./docs/contributing/code-style.md), [releasing](./docs/contributing/releasing.md).

## Code conventions

- TypeScript. ESLint and Prettier enforce style: single quotes, no trailing commas, semicolons, 120-character lines, 2-space indent, sorted imports. Let `eslint --fix` do the formatting.
- Avoid `any`. ESLint allows it, but the project convention is not to use it.
- Unit tests sit next to the code in `packages/*/src/__tests__/` and run with Vitest. They use PGlite (in-process PostgreSQL), so no Docker is needed.
- Update the documentation in `docs/` or the package README when you change behaviour or an API.

## Changesets

Releases use [Changesets](https://github.com/changesets/changesets). A change to a **published** package needs a changeset (`pnpm changeset`): the package, the kind of change (`patch` fix, `minor` compatible feature, `major` breaking) and a one-line summary. See the [versioning and deprecation policy](./docs/contributing/releasing.md#versioning-and-deprecation-policy).

No changeset for documentation, tests, examples, CI, the Claude Code plugin or the private packages.

## Commits and pull requests

- Never commit or push automatically. Ask the user first.
- Sign off every commit (`git commit -s`). The DCO check fails a pull request if any commit lacks `Signed-off-by`, and the name and email must match the commit author.
- Commit messages start with a type: `fix:`, `feat:`, `docs:`, `test:`, `chore:`.
- Branch from `main` and open pull requests against `main`. Keep each pull request to one change.
- The pre-commit hook (husky) runs `lint-staged` and `pnpm run versions:check`, so `pnpm` must be on the `PATH`. Do not bypass the hook with `--no-verify`.
- CI must pass: build, typecheck, lint, unit and integration tests, package checks and the documentation link check.

## Claude Code marketplace

The repository is also a public Claude Code plugin marketplace named `loft`:

- [`.claude-plugin/marketplace.json`](./.claude-plugin/marketplace.json) is the registry. It lists each plugin with its `source` path and metadata.
- [`plugins/`](./plugins/) holds the plugins. Today there is one: [`loft-integration`](./plugins/loft-integration/), which helps users set up, change and review LOFT integrations.

Users install it with:

```bash
claude plugin marketplace add MoC-OSS/LOFT
claude plugin install loft-integration@loft
```

`plugins/` and `.claude-plugin/` are not pnpm workspaces and are not published to npm. They are not part of changesets.

### Plugin anatomy

Each plugin lives under `plugins/<name>/` and can contain any combination of:

| Directory/File | Purpose |
|---|---|
| `.claude-plugin/plugin.json` | **Required.** Plugin metadata (name, version, description, author, homepage, repository, license, keywords) |
| `README.md`, `CHANGELOG.md` | Human-readable description and release history |
| `skills/*/SKILL.md` | Trigger-based prompt definitions with YAML frontmatter (`name`, `description`, `metadata`); body is the system prompt |
| `commands/*.md` | Slash command prompts invoked via `/<command-name>`; use `$ARGUMENTS` for user input |
| `agents/*.md` | Specialized sub-agent definitions that skills can dispatch as `<plugin>:<agent>` |
| `references/*.md` | Static documentation files that skills read for context |
| `scripts/` | Scripts for scaffolding or setup tasks |
| `evals/` | Skill evaluation configs; run output goes to the gitignored `evals/workspace/` |

Only the plugin directory is copied into a user's plugin cache. Reference plugin files as `${CLAUDE_PLUGIN_ROOT}/…` and never reach outside the plugin directory (`../`).

### Plugin conventions

- Plugins are licensed MIT, like the rest of LOFT.
- The plugin version lives **only** in `plugins/<name>/.claude-plugin/plugin.json` (semver), and `SKILL.md` `metadata.version` matches it. The marketplace entry carries no `version`.
- Bump the version and add a dated `CHANGELOG.md` entry for every change users should receive. Without a bump, installed copies are not updated.
- Keep the marketplace entry `name` identical to the `plugin.json` `name`.
- When modifying a plugin, read its `README.md` and existing skill/agent files first to understand its prerequisites and patterns.
- When creating or refactoring a skill, command or agent, follow [docs/contributing/claude-plugin-authoring.md](./docs/contributing/claude-plugin-authoring.md).

### Adding a new plugin

1. Create `plugins/<name>/` with at least `.claude-plugin/plugin.json`, a `README.md` and a `CHANGELOG.md`.
2. Add skills, commands, agents or references as needed.
3. Register the plugin in `.claude-plugin/marketplace.json` (add an entry to the `plugins` array, without `version`).
4. Run the checks below.

### Plugin checks

After changing any plugin or the marketplace, run:

```bash
claude plugin validate . --strict
claude plugin validate ./plugins/<name> --strict
python3 scripts/lint_skills.py --plugin <name> --strict   # requires PyYAML
python3 -m pytest scripts/                                 # requires pytest
```

CI does not run these checks, so run them before every plugin change.
