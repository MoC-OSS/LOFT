import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

/**
 * Configuration for creating a PGLite instance
 */
export interface PGLiteInstanceConfig {
  /** PostgreSQL extensions to load */
  extensions?: Record<string, any>;
}

/**
 * Configuration for the PGLite socket server
 */
export interface PGLiteSocketConfig {
  /** Host to bind the socket server to (default: '127.0.0.1') */
  host?: string;
  /** Port to bind the socket server to. If not provided, OS will assign a free port */
  port?: number;
}

/**
 * PGLite database instance with socket server
 *
 * ⚠️ IMPORTANT: PGLite supports only one active connection at a time.
 * When creating a connection pool, always set max: 1 to avoid deadlocks.
 */
export interface PGLiteInstance {
  /** The underlying PGLite database */
  db: PGlite;
  /** The socket server for external connections */
  server: PGLiteSocketServer;
  /** PostgreSQL connection string for external clients */
  connectionString: string;
  /** The port the socket server is listening on */
  port: number;
  /** Cleanup function to close everything */
  close: () => Promise<void>;
}

/**
 * Port allocation result
 */
export interface PortAllocation {
  /** The allocated port number */
  port: number;
}
