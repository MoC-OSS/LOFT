# Build System

LOFT uses Turbo for orchestration, tsup for bundling, and TypeScript for type generation. This page documents how builds work.

## Turbo Pipeline

Defined in `turbo.json`:

| Task | Dependencies | Outputs | Description |
|------|-------------|---------|-------------|
| `build` | `prebuild`, `^build` | `lib/**`, `dist/**` | Build package (runs after dependencies) |
| `prebuild` | none | none | Pre-build step (if needed) |
| `lint` | none | none | ESLint across all packages, with `--fix` |
| `lint:check` | none | none | ESLint without fixes, failing on warnings (used in CI) |
| `check-types` | `^build` | none | TypeScript type checking (requires deps built) |

The `^build` notation means "this package's workspace dependencies must be built first." Turbo resolves the dependency graph automatically.

### Build Order

Turbo builds packages in dependency order:

```
Phase 0: loft-definitions, loft-pglite (no workspace dependencies; loft-base-tsconfig has no build step)
Phase 1: loft-test-suite (loft-definitions, loft-pglite), loft-kysely-pg-migrator (loft-pglite),
         loft-llm-call-manager and the storage and queue packages (loft-definitions)
Phase 2: loft and the LLM strategies (loft-definitions, loft-test-suite);
         the PostgreSQL repositories (also loft-kysely-pg-migrator, loft-pglite)
Phase 3: loft-agents (loft), loft-middleware (loft, loft-test-suite)
Phase 4: loft-integration-tests (depends on everything)
```

Turbo counts devDependencies too, so a package that tests with `loft-test-suite` builds after it.

Within each phase, packages build in parallel.

### Caching

Turbo caches build outputs (`lib/**`, `dist/**`). If source files haven't changed, the build is skipped. Cache busting happens automatically when source or dependency source changes.

## tsup Configuration

Each package uses tsup for dual ESM + CJS bundling. Standard config:

```typescript
// tsup.config.ts (most packages)
export default defineConfig({
  entry: ['./src/index.ts'],
  format: ['esm', 'cjs'],
  splitting: false,
  sourcemap: true,
  outDir: 'lib',
  clean: true,
  dts: false,       // Declarations come from tsc, see below
  external: []
});
```

**Output:**
- `lib/index.mjs` — ESM
- `lib/index.js` — CJS
- `lib/index.js.map` — Sourcemaps
- `lib/index.d.ts` — TypeScript declarations for `require` (from tsc)
- `lib/index.d.mts` — TypeScript declarations for `import` (from `scripts/emit-esm-types.mjs`)

### Three-Step Build

Each published package's `build` script runs:

```bash
tsup && tsc -p tsconfig.declarations.json && node ../../scripts/emit-esm-types.mjs
```

1. **tsup** — Generates JavaScript bundles (ESM + CJS) with sourcemaps
2. **tsc** — Generates TypeScript declarations (`.d.ts`) with declaration maps, one file per source file
3. **emit-esm-types** — Writes a `.d.mts` twin of every `.d.ts` file, with relative paths pointed at `.mjs` files, so code that imports a package gets ES module types and code that requires it gets CommonJS types

Declarations come from tsc, not from tsup's `dts` option, because tsup bundles them into one file and turns namespace exports such as `Interface` into type aliases. Code that emits its own declarations then fails to name LOFT types (TS4023, TS4058), in this repository and in libraries built on LOFT.

### Special Case: Repository Packages

`loft-session-pg-repository` and `loft-chat-history-pg-repository` use multi-config tsup:

- **Config 1:** Regular code → ESM + CJS
- **Config 2:** Migrations + CLI bins → CJS only (Kysely's `FileMigrationProvider` requires `require()`)

## TypeScript Configuration

All packages inherit from `packages/loft-base-tsconfig/base-tsconfig.json`:

| Setting | Value | Reason |
|---------|-------|--------|
| `target` | ES2022 | Modern JavaScript |
| `module` | CommonJS | Compatibility |
| `strict` | true | Enforced strict mode |
| `strictNullChecks` | true | Null safety |
| `experimentalDecorators` | true | Required for Inversify `@inject()` |
| `emitDecoratorMetadata` | true | Required for Inversify DI |
| `declaration` | true | Generate `.d.ts` files |
| `declarationMap` | true | IDE navigation support |
| `skipLibCheck` | true | Faster builds |

Each package has:
- `tsconfig.json` — Used for type-checking (`tsc --noEmit`)
- `tsconfig.declarations.json` — Used for declaration generation (`emitDeclarationOnly: true`)

## Pre-Commit Pipeline

`.husky/pre-commit` runs these steps sequentially (fail-fast):

| Step | Command | Purpose |
|------|---------|---------|
| 1 | `npx lint-staged` | ESLint `--fix` on staged `.ts/.tsx/.js/.jsx` files |
| 2 | `pnpm run versions:check` | Validate cross-package version consistency; fix with `pnpm versions:align` |

The build, type check, tests and package checks run in CI (`.github/workflows/ci.yml`); run them before you push (see [CONTRIBUTING.md](../../CONTRIBUTING.md)).

## Package Exports Pattern

Every published package uses conditional exports:

```json
{
  "exports": {
    ".": {
      "import": { "types": "./lib/index.d.mts", "default": "./lib/index.mjs" },
      "require": { "types": "./lib/index.d.ts", "default": "./lib/index.js" }
    },
    "./package.json": "./package.json"
  }
}
```

Each condition carries its own types, so TypeScript sees ES module types for `import` and CommonJS types for `require`. CI checks this with attw (`pnpm check:types-exports`) and publint (`pnpm check:manifests`).
