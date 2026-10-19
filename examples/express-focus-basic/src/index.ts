import 'reflect-metadata';

import express from 'express';

import { env } from './config';
import { initializeDatabase } from './database';
import { initializeLoft, MODEL_NAME } from './loft/setup';
import { registerRoutes } from './routes';

async function main() {
  console.log('Starting express-focus-basic example (Pizza Order Bot)...');

  const db = await initializeDatabase();
  console.log('Connected to Docker PostgreSQL');

  const { loft, loftConstructor, chat } = await initializeLoft(db.pool);
  console.log(`LOFT initialized with Anthropic ${MODEL_NAME} strategy`);

  const app = express();
  // Do not tell clients which framework serves them
  app.disable('x-powered-by');
  app.use(express.json());
  registerRoutes(app, chat);

  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\nShutting down...');
    try {
      await loft.shutdown();
      await loftConstructor.gracefulShutdown();
      await db.close();
      console.log('Shutdown complete');
    } catch (error) {
      console.error('Shutdown error:', error);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  app.listen(env.PORT, () => {
    console.log(`\nPizza Order Bot running on http://localhost:${env.PORT}`);
    console.log('GET  /health                    — Health check');
    console.log('POST /api/sessions              — Create a session');
    console.log('POST /api/chat                  — Send a message (body: { sessionId, message })');
    console.log('GET  /api/sessions/:id/history  — Get conversation history');
    console.log('');
  });
}

main().catch((error) => {
  console.error('Startup failed:', error);
  process.exit(1);
});
