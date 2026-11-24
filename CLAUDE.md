# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For the LOFT monorepo itself (packages, build, tests, changesets), follow [AGENTS.md](./AGENTS.md) and [CONTRIBUTING.md](./CONTRIBUTING.md). This file covers the **Claude Code marketplace** that lives in the same repository.

## The Claude Code marketplace

This repository is also a public Claude Code plugin marketplace named `loft`:

- [`.claude-plugin/marketplace.json`](./.claude-plugin/marketplace.json) is the registry. It lists each plugin with its `source` path and metadata.
- [`plugins/`](./plugins/) holds the plugins. Today there is one: [`loft-integration`](./plugins/loft-integration/), which helps users set up, change and review LOFT integrations.

Users install it with:

```bash
claude plugin marketplace add MoC-OSS/LOFT
claude plugin install loft-integration@loft
```

`plugins/` and `.claude-plugin/` are not pnpm workspaces and are not published to npm. They are not part of changesets.

## Plugin anatomy

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

## Conventions

- Plugins are licensed MIT, like the rest of LOFT.
- The plugin version lives **only** in `plugins/<name>/.claude-plugin/plugin.json` (semver), and `SKILL.md` `metadata.version` matches it. The marketplace entry carries no `version`.
- Bump the version and add a dated `CHANGELOG.md` entry for every change users should receive. Without a bump, installed copies are not updated.
- Keep the marketplace entry `name` identical to the `plugin.json` `name`.
- When modifying a plugin, read its `README.md` and existing skill/agent files first to understand its prerequisites and patterns.
- Never commit automatically without user confirmation.

## Adding a new plugin

1. Create `plugins/<name>/` with at least `.claude-plugin/plugin.json`, a `README.md` and a `CHANGELOG.md`.
2. Add skills, commands, agents or references as needed.
3. Register the plugin in `.claude-plugin/marketplace.json` (add an entry to the `plugins` array, without `version`).
4. Run the checks below.

## Checks

After changing any plugin or the marketplace, run:

```bash
claude plugin validate . --strict
claude plugin validate ./plugins/<name> --strict
python3 scripts/lint_skills.py --plugin <name> --strict   # requires PyYAML
python3 -m pytest scripts/                                 # requires pytest
```

CI runs the same checks in the `claude-plugin` job.

When creating or refactoring a skill, command or agent, follow [docs/contributing/claude-plugin-authoring.md](./docs/contributing/claude-plugin-authoring.md).
