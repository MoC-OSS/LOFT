import { PGlite } from '@electric-sql/pglite';
// @ts-expect-error - TypeScript module resolution issue with contrib exports
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

import { PortManager } from './PortManager';
import { PGLiteInstance, PGLiteInstanceConfig, PGLiteSocketConfig } from './types';

/**
 * Factory for creating PGLite instances with socket servers
 * Ensures proper configuration for PGLite's single-connection limitation
 */
export class PGLiteInstanceFactory {
  /**
   * Creates a complete PGLite instance with socket server and pool
   *
   * @param instanceConfig Configuration for the PGLite instance
   * @param socketConfig Configuration for the socket server
   * @returns Promise that resolves to a complete PGLiteInstance
   */
  static async create(
    instanceConfig: PGLiteInstanceConfig = {},
    socketConfig: PGLiteSocketConfig = {}
  ): Promise<PGLiteInstance> {
    // Create in-memory PGlite instance with default uuid_ossp extension
    const extensions = {
      uuid_ossp,
      ...instanceConfig.extensions
    };

    const db = new PGlite({
      extensions
    });

    // Allocate port from OS if not provided
    const port = socketConfig.port ?? (await PortManager.allocatePort()).port;
    const host = socketConfig.host ?? '127.0.0.1';

    console.log(`Creating PGLite socket server on ${host}:${port}`);

    // Create PGlite socket server
    const server = new PGLiteSocketServer({
      db,
      port,
      host
    });

    // Start the server
    await server.start();

    // Create connection string
    const connectionString = `postgresql://postgres@${host}:${port}/postgres`;

    // Setup cleanup function
    const close = async (): Promise<void> => {
      console.log(`Closing PGLite instance on port ${port}`);
      await server.stop();
      await db.close();
    };

    return {
      db,
      server,
      connectionString,
      port,
      close
    };
  }
}
