import { Pool } from 'pg';

import { type PGLiteInstance } from '../types';

/**
 * Creates a Pool for the given PGLite instance
 * PGLite requires max: 1 for single connection limitation
 */
export const createPool = (instance: PGLiteInstance): Pool => {
  return new Pool({
    connectionString: `postgresql://postgres@localhost:${instance.port}/postgres`,
    max: 1
  });
};
