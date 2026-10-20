import { createServer } from 'node:net';

import { PGlite } from '@electric-sql/pglite';
// @ts-expect-error The pglite contrib subpaths have no types under "moduleResolution": "node"
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { runChatHistoryPgMigrations } from '@moc-global/loft-chat-history-pg-repository';
import { runSessionPgMigrations } from '@moc-global/loft-session-pg-repository';
import { Pool } from 'pg';

import { env } from './config';

export interface Database {
  pool: Pool;
  close: () => Promise<void>;
}

/**
 * Starts PGlite, an in-memory PostgreSQL, behind a local socket so `pg` can connect to it, then applies the
 * LOFT migrations. Data is lost when the process exits; use a real PostgreSQL server in production.
 */
export async function initializeDatabase(): Promise<Database> {
  console.log('Starting PGlite (in-process PostgreSQL)...');

  // The migrations default ids to uuid_generate_v4(), which comes from the uuid-ossp extension
  const db = new PGlite({ extensions: { uuid_ossp } });
  let port: number;
  let server: PGLiteSocketServer;
  try {
    port = await findFreePort();
    server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
    await server.start();
  } catch (error) {
    await db.close().catch(() => undefined);
    throw error;
  }

  const databaseUrl = `postgresql://postgres@127.0.0.1:${port}/postgres`;
  // PGlite serves one connection at a time
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  // Closes all three even when one of them fails
  const close = async () => {
    try {
      await pool.end();
    } finally {
      try {
        await server.stop();
      } finally {
        await db.close();
      }
    }
  };

  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    for (const schema of [env.LOFT_SESSION_SCHEMA, env.LOFT_CHAT_HISTORY_SCHEMA]) {
      await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    }

    await runSessionPgMigrations(
      { databaseUrl, direction: 'to-latest', schemaName: env.LOFT_SESSION_SCHEMA, libraryVersion: '0.0.1' },
      pool
    );
    await runChatHistoryPgMigrations(
      { databaseUrl, direction: 'to-latest', schemaName: env.LOFT_CHAT_HISTORY_SCHEMA, libraryVersion: '0.0.1' },
      pool
    );

    console.log('PGlite ready — schemas created, migrations applied');
  } catch (error) {
    // The open socket server would keep the process running. Keep the setup error, not a close error.
    await close().catch(() => undefined);
    throw error;
  }

  return { pool, close };
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
