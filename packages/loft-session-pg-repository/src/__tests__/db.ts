import { Pool } from 'pg';

import { config } from './config';

const { DATABASE_NAME, DATABASE_HOST, DATABASE_USER, DATABASE_PASSWORD, DATABASE_PORT } = config;

// Create a PostgreSQL connection pool
const pool = new Pool({
  database: DATABASE_NAME,
  host: DATABASE_HOST,
  user: DATABASE_USER,
  password: DATABASE_PASSWORD,
  port: Number(DATABASE_PORT)
});

pool.on('error', (err) => {
  console.error('Unexpected DB Pool error on idle client', err);
  process.exit(-1);
});

// Only export the pool - all operations should be performed via the repository
export { pool };
