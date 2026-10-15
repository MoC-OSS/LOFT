import { PGLiteInstanceFactory, PGLiteUtils } from '@moc-global/loft-pglite';
import { describe, expect, it } from 'vitest';

// Test files start their PGlite databases in parallel, so each instance needs its own port
describe('Parallel PGlite instances', () => {
  it('gives 10 instances started at once 10 different ports, each serving queries', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const instance = await PGLiteInstanceFactory.create();
        const pool = PGLiteUtils.createPool(instance);
        try {
          const { rows } = await pool.query<{ ok: number }>('SELECT 1 AS ok');
          return { port: instance.port, ok: rows[0].ok };
        } finally {
          await pool.end();
          await instance.close();
        }
      })
    );

    expect(results.map((result) => result.ok)).toEqual(Array.from({ length: 10 }, () => 1));
    expect(new Set(results.map((result) => result.port)).size).toBe(10);
  }, 120000);
});
