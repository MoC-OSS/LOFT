# Local Setup

This guide covers setting up the LOFT monorepo for development.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| **Node.js** | v22+ | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| **pnpm** | 10.14.0 (enforced via `packageManager` field) | `corepack enable && corepack prepare pnpm@10.14.0 --activate` |
| **Git** | Any recent | OS package manager |
| **Docker** | Optional — only for package-level integration tests | [docker.com](https://docker.com) |

> **Note:** There is no `.nvmrc`, `.node-version`, or `.tool-versions` file in the repo. The `packageManager` field in root `package.json` enforces pnpm 10.14.0 via Corepack. Packages declare `engines.node >=22`, except the PostgreSQL repositories, the migrator and the call manager, which load ES module-only dependencies through `require()` and declare `>=22.12`. CI tests Node 22.12, 22, 24 and 26.

## Initial Setup

```bash
# Clone the repository
git clone https://github.com/MoC-OSS/LOFT.git
cd LOFT

# Enable Corepack (ensures correct pnpm version)
corepack enable

# Install all dependencies
pnpm install

# Build all packages (required before type-checking)
turbo build

# Verify everything works
pnpm test:unit
```

## Daily Workflow

```bash
# After pulling new changes
pnpm install
turbo build

# Work on a specific package
# Edit files in packages/loft-definitions/src/...

# Rebuild just that package and its dependents
turbo build --filter=@moc-global/loft-definitions

# Run unit tests
pnpm test:unit

# Lint all packages
turbo lint

# Type-check (requires packages to be built)
turbo check-types
```

## Key Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `turbo build` | Build all packages (respects dependency order) |
| `turbo build --filter=<pkg>` | Build a specific package and its deps |
| `turbo lint` | Lint all packages |
| `turbo check-types` | Type-check all packages (requires build) |
| `pnpm test:unit` | Run all unit tests (no Docker needed) |
| `pnpm test:integration` | Run the integration tests on the sources (PGlite, no keys needed) |
| `pnpm test:integration:esm`, `pnpm test:integration:cjs` | Run them on the built ES module or CommonJS packages |
| `pnpm run versions:check` | Check cross-package version consistency |
| `pnpm run versions:align` | Auto-fix version mismatches |

## Adding Dependencies

```bash
# Add to a specific package
pnpm add some-package --filter=@moc-global/loft

# Add dev dependency to root (shared tooling)
pnpm add -D some-tool --workspace-root

# Add internal workspace dependency
pnpm add @moc-global/loft-definitions --filter=@moc-global/loft --workspace
```

Internal dependencies use the `workspace:*` protocol (enforced by Manypkg).

## Workspace Structure

```
LOFT/
├── packages/                  # 17 packages (pnpm workspace)
│   ├── loft/                  # Core framework
│   ├── loft-definitions/      # Types, interfaces, DI symbols
│   └── ...                    # See reference/packages.md for full list
├── examples/                  # Runnable example applications (pnpm workspace)
│   ├── express-basic/         # Stateless single-turn chat
│   ├── express-history/       # Multi-turn with persistent sessions
│   ├── express-full/          # Production-like: middleware, Docker PG
│   ├── nestjs/                # NestJS module integration
│   └── serverless/            # AWS Lambda handler
├── integration/               # Integration test suite (pnpm workspace)
├── package.json               # Root: scripts, devDependencies, packageManager
├── pnpm-workspace.yaml        # Workspace config: packages/*, examples/*, integration
├── turbo.json                 # Build pipeline
├── vitest.config.mts          # Unit test config
├── .eslintrc                  # Linting rules
├── .prettierrc                # Formatting rules
└── .husky/pre-commit          # Pre-commit pipeline
```

## Troubleshooting

**"Cannot find module" after pulling changes:**
```bash
pnpm install && turbo build
```
Internal packages resolve via `workspace:*` symlinks — they need `lib/` output to exist.

**Type errors in `check-types` but not in IDE:**
```bash
turbo build    # check-types depends on ^build
turbo check-types
```

**`manypkg check` fails:**
```bash
pnpm run versions:align
```
All internal deps must use `workspace:*` protocol.
