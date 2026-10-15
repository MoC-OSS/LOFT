import * as net from 'net';

import { PortAllocation } from './types';

/**
 * Manages port allocation for PGLite socket servers
 * Uses OS-based port allocation for uniqueness and parallel test execution
 */
export class PortManager {
  /**
   * Allocates a free port from the OS
   * This is fast, reliable, and handles uniqueness automatically
   *
   * @returns Promise that resolves to the allocated port number
   * @throws Error if port allocation fails
   */
  static async allocatePort(): Promise<PortAllocation> {
    return new Promise<PortAllocation>((resolve, reject) => {
      const server = net.createServer();

      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          server.close();
          reject(new Error('Failed to get port allocation from OS'));
          return;
        }

        const port = address.port;
        server.close(() => {
          console.log(`Process ${process.pid} allocated port ${port}`);
          resolve({ port });
        });
      });

      server.on('error', (err) => {
        server.close();
        reject(new Error(`Port allocation failed: ${err.message}`));
      });
    });
  }
}
