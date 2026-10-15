import { Pool } from 'pg';

import { env } from './config';

export interface Database {
  pool: Pool;
  close: () => Promise<void>;
}

export async function initializeDatabase(): Promise<Database> {
  const pool = new Pool({
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DB
  });

  return {
    pool,
    close: async () => {
      await pool.end();
    }
  };
}
