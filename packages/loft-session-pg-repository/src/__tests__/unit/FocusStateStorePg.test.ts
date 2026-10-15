import type { PGLiteInstance } from '@moc-global/loft-pglite';
import { PGLiteInstanceFactory, PGLiteUtils } from '@moc-global/loft-pglite';
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FocusStateStorePg } from '../../repository/FocusStateStorePg';

const SCHEMA = 'loft_session_test';

let pgliteInstance: PGLiteInstance;
let pool: Pool;
let db: Kysely<any>;
let store: FocusStateStorePg;

beforeAll(async () => {
  pgliteInstance = await PGLiteInstanceFactory.create();
  pool = PGLiteUtils.createPool(pgliteInstance);

  await PGLiteUtils.createSchemas(pool, [SCHEMA]);
  await PGLiteUtils.createExtensions(pool);

  // Create session table (needed for FK reference)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.session (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      ctx JSONB NOT NULL DEFAULT '{}',
      current_llm_name VARCHAR(512) NOT NULL,
      current_manifest_name VARCHAR(1024) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Create focus_state table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.focus_state (
      session_id UUID NOT NULL REFERENCES ${SCHEMA}.session(id) ON DELETE CASCADE,
      agent_name VARCHAR(255) NOT NULL,
      field_key VARCHAR(255) NOT NULL,
      value JSONB NOT NULL,
      PRIMARY KEY (session_id, agent_name, field_key)
    )
  `);

  db = new Kysely({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin()]
  });

  store = new FocusStateStorePg(db, SCHEMA);
});

afterAll(async () => {
  await db.destroy();
  await pgliteInstance.close();
});

// Insert a test session and return its ID
async function createTestSession(): Promise<string> {
  const result = await pool.query(
    `INSERT INTO ${SCHEMA}.session (current_llm_name, current_manifest_name) VALUES ('test-llm', 'test-manifest') RETURNING id`
  );
  return result.rows[0].id;
}

describe('FocusStateStorePg', () => {
  let sessionId: string;

  beforeEach(async () => {
    await pool.query(`DELETE FROM ${SCHEMA}.focus_state`);
    await pool.query(`DELETE FROM ${SCHEMA}.session`);
    sessionId = await createTestSession();
  });

  it('should set and get a value', async () => {
    await store.set(sessionId, 'intake', 'vehicleType', 'car');
    const value = await store.get(sessionId, 'intake', 'vehicleType');
    expect(value).toBe('car');
  });

  it('should return undefined for non-existent field', async () => {
    const value = await store.get(sessionId, 'intake', 'nonexistent');
    expect(value).toBeUndefined();
  });

  it('should upsert on set (overwrite existing value)', async () => {
    await store.set(sessionId, 'intake', 'vehicleType', 'car');
    await store.set(sessionId, 'intake', 'vehicleType', 'truck');
    const value = await store.get(sessionId, 'intake', 'vehicleType');
    expect(value).toBe('truck');
  });

  it('should store numeric values', async () => {
    await store.set(sessionId, 'intake', 'year', 2020);
    const value = await store.get(sessionId, 'intake', 'year');
    expect(value).toBe(2020);
  });

  it('should delete a specific field', async () => {
    await store.set(sessionId, 'intake', 'vehicleType', 'car');
    await store.set(sessionId, 'intake', 'year', 2020);
    await store.delete(sessionId, 'intake', 'vehicleType');

    expect(await store.get(sessionId, 'intake', 'vehicleType')).toBeUndefined();
    expect(await store.get(sessionId, 'intake', 'year')).toBe(2020);
  });

  it('should clear all fields for an agent', async () => {
    await store.set(sessionId, 'intake', 'vehicleType', 'car');
    await store.set(sessionId, 'intake', 'year', 2020);
    await store.set(sessionId, 'other', 'field1', 'value1');

    await store.clear(sessionId, 'intake');

    expect(await store.get(sessionId, 'intake', 'vehicleType')).toBeUndefined();
    expect(await store.get(sessionId, 'intake', 'year')).toBeUndefined();
    expect(await store.get(sessionId, 'other', 'field1')).toBe('value1');
  });

  it('should clearAll fields for a session', async () => {
    await store.set(sessionId, 'intake', 'vehicleType', 'car');
    await store.set(sessionId, 'other', 'field1', 'value1');

    await store.clearAll(sessionId);

    expect(await store.get(sessionId, 'intake', 'vehicleType')).toBeUndefined();
    expect(await store.get(sessionId, 'other', 'field1')).toBeUndefined();
  });

  it('should getAll fields for an agent', async () => {
    await store.set(sessionId, 'intake', 'vehicleType', 'car');
    await store.set(sessionId, 'intake', 'year', 2020);
    await store.set(sessionId, 'other', 'field1', 'value1');

    const result = await store.getAll(sessionId, 'intake');
    expect(result).toEqual({ vehicleType: 'car', year: 2020 });
  });

  it('should return empty object from getAll when no fields exist', async () => {
    const result = await store.getAll(sessionId, 'intake');
    expect(result).toEqual({});
  });
});
