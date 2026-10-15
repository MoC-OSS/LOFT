import { Pool } from 'pg';

/**
 * Creates database schemas using the provided pool
 */
export const createSchemas = async (pool: Pool, schemas: string[]): Promise<void> => {
  const client = await pool.connect();

  try {
    for (const schema of schemas) {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    }
  } finally {
    client.release();
  }
};

/**
 * Creates database extensions using the provided pool
 */
export const createExtensions = async (pool: Pool, extensions: string[] = ['uuid-ossp']): Promise<void> => {
  const client = await pool.connect();

  try {
    for (const extension of extensions) {
      await client.query(`CREATE EXTENSION IF NOT EXISTS "${extension}"`);
    }
  } finally {
    client.release();
  }
};
