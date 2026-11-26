# LOFT Integration Plugin

A Claude Code plugin that helps you integrate, configure, and work with the LOFT framework (`@moc-global/loft`) in your TypeScript projects.

## What It Does

- **Setup** — Interactive questionnaire that generates install commands and boilerplate for your specific stack (Express/NestJS/serverless + OpenAI/Anthropic/Gemini + PG/S3/GCS/Azure)
- **Modify** — Guided modifications: adding middleware, switching LLM providers, configuring storage backends
- **Guide** — Fetches latest LOFT documentation from the monorepo and explains concepts in context
- **Analyze** — Deep review of your LOFT integration against best practices

## Install

```bash
claude plugin marketplace add MoC-OSS/LOFT
claude plugin install loft-integration@loft
```

Or, inside a Claude Code session: `/plugin marketplace add MoC-OSS/LOFT`, then `/plugin install loft-integration@loft`.

To get new versions, refresh the marketplace and update the plugin (auto-update is off by default for third-party marketplaces; you can turn it on under `/plugin` → Marketplaces):

```bash
claude plugin marketplace update loft
claude plugin update loft-integration@loft
```

## Prerequisites

- A TypeScript project
- Optional: the `gh` CLI or `curl`, so the plugin can fetch the latest docs from the public [`MoC-OSS/LOFT`](https://github.com/MoC-OSS/LOFT) repository. Without network access it falls back to its embedded references.

## Usage

The skill triggers automatically when you mention LOFT integration tasks. You can also invoke it directly:

- "Help me set up LOFT in my Express project"
- "How do I add Anthropic as an LLM provider?"
- "Review my LOFT integration for issues"
- "Explain how the middleware pipeline works"

## Documentation Access

The plugin uses a three-tier documentation strategy:

1. **Embedded references** — curated essentials always available
2. **GitHub** — fetches latest docs from the public LOFT repository via `gh api` or raw files
3. **Installed packages** — reads source code and types from `node_modules/@moc-global/`

## Supported LOFT Version

The embedded references were verified against loft 3.0.0. With a different LOFT version, the plugin checks your installed packages and the latest docs before relying on them.

## Contributing

The plugin lives in the LOFT monorepo. See the "Claude Code plugin" section of [CONTRIBUTING.md](../../CONTRIBUTING.md) and [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](../../LICENSE)
