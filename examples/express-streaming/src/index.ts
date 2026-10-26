import 'reflect-metadata';

import { createApp } from './app';
import { env } from './config';
import { Database, initializeDatabase } from './database';
import { initializeLoft, LLM_NAME } from './loft';

async function main() {
  console.log('Starting express-streaming example...');

  const db: Database = await initializeDatabase();
  console.log('PGLite database initialized (in-process, no external DB needed)');

  const { loft } = await initializeLoft(db.pool);
  console.log(`LOFT initialized with the OpenAI ${LLM_NAME} strategy`);

  // The default disconnect policy, 'abort', cancels the generation when the client goes away. To let it finish and
  // be saved instead, use { onDisconnect: 'finish', maxGenerationMs: 120_000 }.
  const { app, closeStreams } = createApp(loft.chat, { sse: { heartbeatMs: 15_000, onDisconnect: 'abort' } });

  const server = app.listen(env.PORT, () => {
    console.log(`express-streaming example running on http://localhost:${env.PORT}`);
    console.log('POST /sessions              — Create a session');
    console.log('POST /chat/stream           — Stream a reply as SSE (body: { sessionId, message })');
    console.log('GET  /sessions/:id/history  — View conversation history');
  });

  // Graceful shutdown: stop accepting connections, abort the running streams (their clients get an `abort` event) and
  // wait for them, then let LOFT finish its work and close the database
  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\nShutting down...');
    try {
      server.close();
      await closeStreams(10_000);
      // Last resort: drops idle keep-alive connections and any stream that did not end in time
      server.closeAllConnections();
      await loft.shutdown();
      await db.close();
      console.log('Shutdown complete');
    } catch (error) {
      console.error('Shutdown error:', error);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Startup failed:', error);
  process.exit(1);
});
