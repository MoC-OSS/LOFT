# @moc-global/loft-pglite

PGLite + Socket utilities for LOFT Framework testing.
In-memory PostgreSQL for tests with automatic port allocation.

## Installation

Usually `@moc-global/loft-pglite` is already in the root `package.json` as a dev dependency, so you can just import and use it:

```typescript
import { PGLiteSocketManager } from '@moc-global/loft-pglite';
```

If not installed:

```bash
pnpm add -D @moc-global/loft-pglite
```

## Quick Start

```typescript
import { PGLiteSocketManager } from '@moc-global/loft-pglite';

// Create instance
const db = await PGLiteSocketManager.createInstance();

// Use it
const client = await db.pool.connect();
await client.query('SELECT NOW()');
client.release();

// Clean up
await db.close();
```

## Testing Example

```typescript
import { PGLiteSocketManager } from '@moc-global/loft-pglite';
import { beforeAll, afterAll } from 'vitest';

describe('My Tests', () => {
  let testDb;

  beforeAll(async () => {
    testDb = await PGLiteSocketManager.createInstance();
    // Run your migrations here
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('works', async () => {
    const client = await testDb.pool.connect();
    // Your test logic
    client.release();
  });
});
```

## Important

- **Pool is always `max: 1`** - PGLite supports only one connection
- **Always call `close()`** when done
- **Port allocation is automatic** - no conflicts in parallel tests

## API

### `PGLiteSocketManager.createInstance()`

Returns `PGLiteInstance` with:

- `pool` - PostgreSQL pool (max: 1)
- `connectionString` - for external tools
- `close()` - cleanup function

### `PGLiteSocketManager.cleanTables(pool, tables)`

Clean tables between tests:

```typescript
await PGLiteSocketManager.cleanTables(db.pool, [{ schema: 'public', table: 'users' }]);
```
