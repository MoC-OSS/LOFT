# LOFT Documentation

**LOFT** (LLM-Orchestrator Framework for TypeScript) is an HTTP-framework-agnostic TypeScript framework for building LLM-powered backend applications. It provides a structured pipeline for LLM orchestration, middleware processing, session management, and chat history persistence.

LOFT is not a standalone application — it is a framework you integrate into your backend (Express, NestJS, serverless, etc.) to handle everything between your API layer and LLM providers.

## Documentation

### Getting Started

New to LOFT? Start here.

- [Introduction](./getting-started/introduction.md) — What LOFT is, what problems it solves, and when to use it
- [Quickstart](./getting-started/quickstart.md) — Get a working LOFT instance in 15 minutes (OpenAI and Anthropic examples)
- [Core Concepts](./getting-started/core-concepts.md) — The mental model: dependency injection, strategies, middleware pipeline, manifests

### Concepts

Understand how LOFT works under the hood.

- [Architecture](./concepts/architecture.md) — System design, package tiers, dependency graph
- [Processing Pipeline](./concepts/processing-pipeline.md) — Request lifecycle: Input → BeforeGenerate → LLM → AfterGenerate
- [Dependency Injection](./concepts/dependency-injection.md) — Inversify, DI_TYPES, Modules vs Components
- [Strategy Pattern](./concepts/strategy-pattern.md) — How LLM providers, storage backends, and call managers are pluggable
- [Agent Orchestration](./concepts/agents/README.md) — Multi-agent workflows: orchestrator, Focus, teams, fan-out

### Guides

Task-oriented how-to guides for specific goals.

- [LLM Strategies](./guides/llm-strategies.md) — Register OpenAI, Anthropic, and Gemini providers
- [Middleware](./guides/middleware.md) — Write and register custom middleware
- [Manifests](./guides/manifests.md) — Configure system prompts and model presets
- [AI Tasks](./guides/ai-tasks.md) — Standalone LLM calls for classification, summarization, and more
- [Chat Persistence](./guides/chat-persistence.md) — Set up PostgreSQL session and chat history storage
- [Database Migrations](./guides/database-migrations.md) — Run schema migrations via CLI
- [MCP Integration](./guides/mcp-integration.md) — Connect MCP servers and tool interceptors
- [Streaming](./guides/streaming.md) — Status: not available through the public API yet
- [Tracing](./guides/tracing.md) — Integrate Langfuse or custom tracers
- [Error Handling](./guides/error-handling.md) — Error types, retry behavior, graceful shutdown
- [Context Window Management](./guides/context-window.md) — Control message history size
- [Agent Orchestration](./guides/agents.md) — Build multi-agent workflows with Focus, FAN_OUT, and Teams

### Reference

Complete technical reference.

- [Packages](./reference/packages.md) — All packages with npm names, directories, and purposes
- [Environment Variables](./reference/environment-variables.md) — Every configuration variable
- [DI Symbols](./reference/di-symbols.md) — All dependency injection symbols
- [Configuration Types](./reference/configuration.md) — LoftConfig, ChatConfig, ManifestManagerConfig

### Contributing

For developers working on the LOFT monorepo itself. Start with [CONTRIBUTING.md](../CONTRIBUTING.md): pull requests, changesets and commit sign-off.

- [Local Setup](./contributing/local-setup.md) — Prerequisites, install, build, first test run
- [Testing](./contributing/testing.md) — Unit tests (PGLite), integration tests, test patterns
- [Build System](./contributing/build-system.md) — Turbo, tsup, TypeScript configuration
- [Releasing](./contributing/releasing.md) — Changesets, versioning, publishing
- [Code Style](./contributing/code-style.md) — ESLint, Prettier, import sorting

## Examples

Runnable reference applications — copy, configure, and run:

| Example                                                 | What it demonstrates                              | Setup            |
| ------------------------------------------------------- | ------------------------------------------------- | ---------------- |
| [express-basic](../examples/express-basic/)             | Stateless single-turn chat                        | API key only     |
| [express-history](../examples/express-history/)         | Multi-turn with PGLite                            | API key only     |
| [express-full](../examples/express-full/)               | Middleware, Anthropic, Docker PG                  | Docker + API key |
| [express-focus-basic](../examples/express-focus-basic/) | Focus: collect a pizza order over several turns   | Docker + API key |
| [express-agents](../examples/express-agents/)           | Multi-agent orchestration (Focus, FAN_OUT, Teams) | Docker + API key |
| [nestjs](../examples/nestjs/)                           | NestJS module integration                         | API key only     |
| [serverless](../examples/serverless/)                   | AWS Lambda handler                                | API key only     |

See [examples/README](../examples/README.md) for detailed setup instructions and quick start guides.

## Key Packages

| Package                                       | Purpose                                                     |
| --------------------------------------------- | ----------------------------------------------------------- |
| `@moc-global/loft`                            | Core framework — LoftConstructor, LOFT, managers            |
| `@moc-global/loft-definitions`                | Types, interfaces, DI symbols, Logger                       |
| `@moc-global/loft-openai-strategy`            | OpenAI / Azure OpenAI LLM provider                          |
| `@moc-global/loft-anthropic-strategy`         | Anthropic Claude LLM provider                               |
| `@moc-global/loft-gemini-strategy`            | Google Gemini LLM provider                                  |
| `@moc-global/loft-session-pg-repository`      | PostgreSQL session storage                                  |
| `@moc-global/loft-chat-history-pg-repository` | PostgreSQL chat history storage                             |
| `@moc-global/loft-llm-call-manager`           | Rate limiting, retry, token management                      |
| `@moc-global/loft-agents`                     | Multi-agent orchestration: nodes, transitions, Focus, teams |

See [Packages Reference](./reference/packages.md) for the full list including storage backends, queue strategies, and internal utilities.

## Architecture Decision Records

- [loft-agents ADRs](./adr/loft-agents/README.md) — Orchestration, Focus, Teams, SharedContext, production hardening
