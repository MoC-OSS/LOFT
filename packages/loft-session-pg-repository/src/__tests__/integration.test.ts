import 'reflect-metadata';

import { testSessionRepository } from '@moc-global/loft-test-suite';
import { afterAll, beforeAll, describe } from 'vitest';

import { config } from './config';
import { pool } from './db';
import { sessionRepo } from './di.init';

const { DATABASE_SESSION_SCHEMA_NAME } = config;

describe('SessionRepository PostgreSQL Integration Tests', () => {
  beforeAll(async () => {
    console.log('Setting up PostgreSQL test environment...');

    // Verify connection health
    const isHealthy = await sessionRepo.checkHealth();
    if (!isHealthy) {
      throw new Error('PostgreSQL connection is not healthy, skipping tests');
    }
    console.log('✅ Connected to PostgreSQL successfully');
  });

  afterAll(async () => {
    console.log('Truncating sessions table...');
    // CASCADE: focus_state rows reference sessions
    await pool.query(`TRUNCATE TABLE ${DATABASE_SESSION_SCHEMA_NAME}.session CASCADE`);
    console.log('✅ Truncated sessions table');

    // Close connection
    console.log('Closing PostgreSQL connection...');
    await pool.end();
    console.log('Connection closed');
  });

  // Run the reusable test suite with repository
  testSessionRepository(sessionRepo);
});
