# Code Style

LOFT enforces consistent code style via ESLint, Prettier, and lint-staged.

## Prettier

Configuration in `.prettierrc`:

| Setting | Value |
|---------|-------|
| Quotes | Single (`'`) |
| Trailing commas | None |
| Semicolons | Yes |
| Print width | 120 characters |
| Tab width | 2 spaces |

Prettier runs as an ESLint rule — formatting violations are reported as ESLint errors.

## ESLint

Configuration in `.eslintrc`:

### Key Rules

| Rule | Setting | Effect |
|------|---------|--------|
| `simple-import-sort/imports` | Error | Imports must be sorted |
| `simple-import-sort/exports` | Error | Exports must be sorted |
| `unused-imports/no-unused-imports` | Error | Unused imports auto-removed |
| `@typescript-eslint/no-unused-vars` | Warn | Unused vars warned (except `_` prefix) |
| `@typescript-eslint/no-explicit-any` | Off | `any` is allowed by ESLint, but **project convention is to avoid it** |
| `prettier/prettier` | Error | Formatting enforced |

### Import Sorting

`simple-import-sort` enforces a consistent import order. Let it auto-fix:

```bash
pnpm turbo lint    # Runs eslint --fix across all packages
```

Typical import order:
```typescript
// 1. Node built-ins
import * as path from 'path';

// 2. External packages (alphabetical)
import { Container } from 'inversify';
import { Pool } from 'pg';

// 3. Internal workspace packages (alphabetical)
import { DI_TYPES, Interface } from '@moc-global/loft-definitions';

// 4. Relative imports (alphabetical)
import { LlmManager } from '../managers';
import { LoftConfig } from '../types';
```

### Unused Variables

- Unused variables with `_` prefix are allowed: `const _unused = getValue();`
- Unused imports are auto-removed by the `unused-imports` plugin

## lint-staged

Configured in root `package.json`:

```json
{
  "lint-staged": {
    "*.{ts,tsx,js,jsx}": "eslint --fix"
  }
}
```

This runs on staged files during pre-commit, providing fast feedback before the full build.

## Conventions

### File Organization

- Source code in `src/`
- Tests in `src/__tests__/`
- Build output in `lib/` (gitignored)
- Each package's `src/index.ts` is the public API surface

### Naming

- Files: `PascalCase.ts` for classes, `camelCase.ts` for utilities
- Classes: `PascalCase`
- Interfaces: `PascalCase` (no `I` prefix)
- Types: `PascalCase`
- Functions/methods: `camelCase`
- Constants: `UPPER_SNAKE_CASE` for DI symbols, `camelCase` for everything else

### TypeScript

- Use strict mode (enforced by base tsconfig)
- Prefer typed interfaces over `any` (even though ESLint allows `any`)
- Use `@inject()` decorator for all DI constructor parameters
- Use `@injectable()` decorator on all DI-managed classes
- Import `'reflect-metadata'` as the first line in entry points
