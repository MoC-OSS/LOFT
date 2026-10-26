# @moc-global/loft-pglite

PGLite + Socket utilities for LOFT Framework testing.
In-memory PostgreSQL for tests with automatic port allocation.

## Installation

Usually `@moc-global/loft-pglite` is already in the root `package.json` as a dev dependency, so you can just import and use it:

```typescript
import { PGLiteInstanceFactory, PGLiteUtils } from '@moc-global/loft-pglite';
```

If not installed:

```bash
pnpm add -D @moc-global/loft-pglite
```

## Quick Start

```typescript
import { PGLiteInstanceFactory, PGLiteUtils } from '@moc-global/loft-pglite';

// Create an instance and a pool on it
const instance = await PGLiteInstanceFactory.create();
const pool = PGLiteUtils.createPool(instance); // max: 1 connection

// Use it
await pool.query('SELECT NOW()');

// Clean up
await pool.end();
await instance.close();
```

## Testing Example

```typescript
import { PGLiteInstanceFactory, PGLiteUtils, type PGLiteInstance } from '@moc-global/loft-pglite';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

describe('My Tests', () => {
  let instance: PGLiteInstance;
  let pool: Pool;

  beforeAll(async () => {
    instance = await PGLiteInstanceFactory.create();
    pool = PGLiteUtils.createPool(instance);
    await PGLiteUtils.createExtensions(pool); // uuid-ossp
    await PGLiteUtils.createSchemas(pool, ['loft_session']);
    // Run your migrations here
  });

  beforeEach(async () => {
    await PGLiteUtils.truncateTables(pool, [{ schema: 'loft_session', table: 'session' }]);
  });

  afterAll(async () => {
    await pool.end();
    await instance.close();
  });

  it('works', async () => {
    await pool.query('SELECT 1');
  });
});
```

## Important

- **Pool is always `max: 1`** - PGLite supports only one connection
- **Always call `close()`** when done
- **Port allocation is automatic** - no conflicts in parallel tests

## API

### `PGLiteInstanceFactory.create(instanceConfig?, socketConfig?)`

Returns a `PGLiteInstance` with:

- `db` - the PGLite database
- `server` - the socket server for external connections
- `connectionString` - for external tools and `pg` clients
- `port` - the port the socket server listens on
- `close()` - cleanup function

### `PGLiteUtils`

- `createPool(instance)` - a `pg` pool on the instance (max: 1)
- `createSchemas(pool, schemas)` - creates the schemas
- `createExtensions(pool, extensions?)` - creates the extensions, `uuid-ossp` by default
- `truncateTables(pool, tables)` - empties tables between tests, such as `[{ schema: 'public', table: 'users' }]`

### `PortManager`

Allocates free ports for the socket servers; `PGLiteInstanceFactory.create()` uses it.
