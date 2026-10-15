import { createServer } from 'node:net';

import { PGlite } from '@electric-sql/pglite';
// @ts-expect-error The pglite contrib subpaths have no types under "moduleResolution": "node"
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { runChatHistoryPgMigrations } from '@moc-global/loft-chat-history-pg-repository';
import { runSessionPgMigrations } from '@moc-global/loft-session-pg-repository';
import { Pool } from 'pg';

const SESSION_SCHEMA = 'loft_session';
const CHAT_HISTORY_SCHEMA = 'loft_chat_history';

export interface Database {
  pool: Pool;
  close: () => Promise<void>;
}

/**
 * Starts PGlite, an in-memory PostgreSQL, behind a local socket so `pg` can connect to it, then applies the
 * LOFT migrations. Data is lost when the process exits; use a real PostgreSQL server in production.
 */
export async function initializeDatabase(): Promise<Database> {
  // The migrations default ids to uuid_generate_v4(), which comes from the uuid-ossp extension
  const db = new PGlite({ extensions: { uuid_ossp } });
  const port = await findFreePort();
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await server.start();

  const databaseUrl = `postgresql://postgres@127.0.0.1:${port}/postgres`;
  // PGlite serves one connection at a time
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  for (const schema of [SESSION_SCHEMA, CHAT_HISTORY_SCHEMA]) {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  }

  await runSessionPgMigrations(
    { databaseUrl, direction: 'to-latest', schemaName: SESSION_SCHEMA, libraryVersion: '0.0.1' },
    pool
  );
  await runChatHistoryPgMigrations(
    { databaseUrl, direction: 'to-latest', schemaName: CHAT_HISTORY_SCHEMA, libraryVersion: '0.0.1' },
    pool
  );

  return {
    pool,
    close: async () => {
      await pool.end();
      await server.stop();
      await db.close();
    }
  };
}

// PGLiteSocketServer treats port 0 as its default, 5432, so ask the operating system for a free port first
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error('No free port for PGlite'))));
    });
  });
}

export { CHAT_HISTORY_SCHEMA, SESSION_SCHEMA };
