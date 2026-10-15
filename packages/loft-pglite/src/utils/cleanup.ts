import { Pool } from 'pg';

/**
 * Truncates specified tables for test cleanup
 * Uses DELETE FROM instead of TRUNCATE for PGLite compatibility
 */
export const truncateTables = async (pool: Pool, tables: Array<{ schema: string; table: string }>): Promise<void> => {
  console.log('Truncating tables:', tables.map((t) => `${t.schema}.${t.table}`).join(', '));

  const client = await pool.connect();
  try {
    // DELETE FROM is safer than TRUNCATE for PGLite
    for (const { schema, table } of tables) {
      await client.query(`DELETE FROM ${schema}.${table}`);
    }
  } finally {
    client.release();
  }
};
