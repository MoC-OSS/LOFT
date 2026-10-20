import { Pool } from 'pg';

import { type PGLiteInstance } from '../types';

/**
 * Creates a Pool for the given PGLite instance
 * PGLite requires max: 1 for single connection limitation
 */
export const createPool = (instance: PGLiteInstance): Pool => {
  return new Pool({
    // The host the server listens on. `localhost` can resolve to ::1 first, and Node.js then tries each address with
    // a 250 ms limit, which a busy process (several PGlite instances starting) misses: connect ETIMEDOUT.
    connectionString: instance.connectionString,
    max: 1
  });
};
