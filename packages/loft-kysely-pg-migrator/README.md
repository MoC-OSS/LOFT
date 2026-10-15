# @moc-global/loft-kysely-pg-migrator

Shared Kysely PostgreSQL migrator for LOFT Framework packages. Provides unified database migration functionality across multiple packages with different schema requirements.

## Overview

This package solves the challenge of managing database migrations in a monorepo where multiple packages (session, chat-history, etc.) need different PostgreSQL schemas but share the same migration infrastructure.

**Key Benefits:**
- **Unified Migration System** - One migration engine for all LOFT database packages
- **Generic CLI Generation** - Each package can have unique environment variables while sharing the same CLI logic
- **Environment Flexibility** - Support for different env files per deployment environment (dev/staging/prod)
- **Schema Isolation** - Each package manages its own database schema through configurable environment mapping

## API Reference

```typescript
// Core exports
createCLI<TEnv>(config: CLIConfig<TEnv>) -> () => Promise<void>
BaseMigrator(options: BaseMigrationOptions, pool?: Pool)
initEnvConfig<T>(schema: ZodSchema<T>, path?: string) -> T
getPackageVersion(packageDir: string) -> string
```

## CLIConfig Interface

```typescript
interface CLIConfig<TEnv> {
  scriptName: string              // CLI display name
  envSchema: z.ZodSchema<TEnv>   // Runtime env validation
  envFieldMapping: {             // Maps standard fields to env vars
    databaseUrl: keyof TEnv      // -> DATABASE_URL
    databaseSsl: keyof TEnv      // -> DATABASE_SSL  
    schemaName: keyof TEnv       // -> DATABASE_*_SCHEMA_NAME (unique per package)
  }
  libraryVersion: string         // Package version for migrations
  migrationsFolder: string       // Path to JS migration files
}
```

## CLI Commands

```bash
<script> <direction> [migration-name] [--env <path>]

# Directions:
up                     # Run next pending migration
down                   # Rollback last migration  
to <name>             # Migrate to specific file
to-latest             # Run all pending migrations
to-current-lib-version # Migrate to package version

# Options:
--env <path>          # Custom env file (default: .env.loft-pg-migrations)
--help                # Show help (works without env file)
```

## Environment Priority

1. **OS environment variables** (highest priority)
2. **Env file** (`.env.loft-pg-migrations` or `--env` path)  
3. **Zod schema defaults** (lowest priority)

## Quick Start

```typescript
// 1. Define your environment schema
const MyEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_SSL: z.preprocess((val) => val === 'true', z.boolean().default(false)),
  DATABASE_MY_SCHEMA_NAME: z.string()
});

// 2. Create CLI with your schema
const cli = createCLI({
  scriptName: 'my-migrate',
  envSchema: MyEnvSchema,
  envFieldMapping: {
    databaseUrl: 'DATABASE_URL',
    databaseSsl: 'DATABASE_SSL',
    schemaName: 'DATABASE_MY_SCHEMA_NAME'  // Unique per package
  },
  libraryVersion: getPackageVersion(__dirname),
  migrationsFolder: './migrations'
});

// 3. Run migrations
cli(); // Parses CLI args and executes
```

```bash
# Create .env.loft-pg-migrations file
echo 'DATABASE_URL=postgresql://user:pass@localhost:5432/mydb' > .env.loft-pg-migrations
echo 'DATABASE_SSL=false' >> .env.loft-pg-migrations  
echo 'DATABASE_MY_SCHEMA_NAME=my_schema' >> .env.loft-pg-migrations

# Run migrations
my-migrate to-latest
```

## Usage Examples

### Generic CLI setup per package
Each package in the monorepo creates its own CLI with unique schema names:
```typescript
const cli = createCLI({
  scriptName: 'my-migrate',
  envSchema: MySchema,
  envFieldMapping: {
    databaseUrl: 'DATABASE_URL',
    databaseSsl: 'DATABASE_SSL',
    schemaName: 'DATABASE_MY_SCHEMA_NAME'
  },
  libraryVersion: getPackageVersion(__dirname),
  migrationsFolder: './migrations'
});
```

### Custom env variable mapping
Different packages map to different schema environment variables:

```typescript
// Session package - uses session-specific schema
envFieldMapping: { 
  databaseUrl: 'DATABASE_URL',
  databaseSsl: 'DATABASE_SSL',
  schemaName: 'DATABASE_SESSION_SCHEMA_NAME' 
}

// Chat History package - uses chat-specific schema  
envFieldMapping: { 
  databaseUrl: 'DATABASE_URL',         // Shared
  databaseSsl: 'DATABASE_SSL',         // Shared
  schemaName: 'DATABASE_CHAT_HISTORY_SCHEMA_NAME'  // Unique
}
```

### Programmatic migration calls
For API or programmatic usage instead of CLI:

```typescript
import { BaseMigrator } from '@moc-global/loft-kysely-pg-migrator';

const migrator = new BaseMigrator({
  databaseUrl: 'postgresql://...',
  databaseSsl: false,
  direction: 'up',
  schemaName: 'my_schema',
  libraryVersion: '1.0.0',
  migrationsFolder: './migrations'
});

await migrator.migrate('up');
await migrator.destroy();
```

### Multi-package integration patterns
Real-world monorepo setup where packages share database but have separate schemas:

```typescript
// .env.loft-pg-migrations (shared across packages)
DATABASE_URL=postgresql://user:pass@localhost:5432/loft_db
DATABASE_SSL=false
DATABASE_SESSION_SCHEMA_NAME=loft_sessions        // Session package uses this
DATABASE_CHAT_HISTORY_SCHEMA_NAME=loft_chat       // Chat package uses this

// Each package's migrator maps to its own schema while sharing connection
```

## Types

```typescript
// Migration directions
type MigrationDirection = 'up' | 'down' | 'to' | 'to-latest' | 'to-current-lib-version'

// Migration options
interface BaseMigrationOptions {
  databaseUrl: string
  databaseSsl: boolean
  direction: MigrationDirection
  migrationName?: string
  schemaName: string
  libraryVersion: string
  migrationsFolder: string
  pool?: Pool
}

// Client options (for programmatic use)
interface ClientMigrationOptions {
  databaseUrl: string
  databaseSsl?: boolean
  direction: MigrationDirection
  migrationName?: string
  schemaName: string
  migrationsFolder?: string
  libraryVersion: string
}
```

## Migration File Structure

```javascript
// migrations/1.0.0.js
module.exports = {
  async up(db) {
    // Forward migration
  },
  async down(db) {
    // Rollback migration
  }
}
```

## Architecture Concepts

### Environment Priority Hierarchy
The migrator follows a strict priority order when loading configuration:

1. **OS Environment Variables** - Highest priority, perfect for CI/CD overrides
2. **Environment File** - Default `.env.loft-pg-migrations` or custom via `--env`
3. **Zod Schema Defaults** - Fallback values defined in your schema

Example:
```bash
# Environment file has DATABASE_URL=postgresql://localhost:5432/dev
# But OS env var overrides it:
DATABASE_URL=postgresql://prod-db:5432/prod my-migrate up
```

### envFieldMapping Purpose
In a monorepo, multiple packages need different database schemas but can share connection details:

```typescript
// Problem: session and chat-history packages both need database access
// Solution: shared connection details, unique schema names per package

// Session package
envFieldMapping: { schemaName: 'DATABASE_SESSION_SCHEMA_NAME' }

// Chat History package  
envFieldMapping: { schemaName: 'DATABASE_CHAT_HISTORY_SCHEMA_NAME' }

// Both packages share DATABASE_URL and DATABASE_SSL
```

### Migration Directions Explained

- **`up`** - Run the next pending migration (incremental)
- **`down`** - Rollback the last applied migration (careful!)
- **`to <name>`** - Migrate to specific migration file (precise control)
- **`to-latest`** - Apply all pending migrations (common for deployments)
- **`to-current-lib-version`** - Migrate to match current package version

## Recent Changes (v1.0.0)

- ✨ Generic `createCLI<TEnv>` with custom environment schemas
- ✨ `--env` CLI argument for custom environment files  
- ✨ `envFieldMapping` for flexible environment variable naming
- 🔧 Help command works without requiring environment file
- 🔄 **BREAKING**: Default env file: `.env` → `.env.loft-pg-migrations`
- 🔄 **BREAKING**: `CLIConfig` interface changed to support generic schemas
