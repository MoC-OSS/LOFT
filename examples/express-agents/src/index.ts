import 'reflect-metadata';

import express from 'express';
import path from 'path';

import { env } from './config';
import { initializeDatabase } from './database';
import { createMainOrchestrator } from './router/orchestrator';
import { registerRoutes } from './routes';
import { initializeLoft, MODEL_NAME } from './shared/setup';

async function main() {
  console.log('Starting Restaurant Agent Showcase...');

  const db = await initializeDatabase();
  console.log('Connected to PostgreSQL');

  const { loft, chat } = await initializeLoft(db.pool);
  console.log(`LOFT initialized with Anthropic ${MODEL_NAME}`);

  const orchestrator = createMainOrchestrator(loft);
  console.log('Orchestrator built — router dispatches to 6 flows:');
  console.log('  simple      → sommelier (single agent)');
  console.log('  chain       → nutritionist → chef → presenter');
  console.log('  parallel    → dispatcher → [appetizers|mains|desserts] → coordinator');
  console.log('  team        → visit → [food-critic + ambiance-critic] → verdict');
  console.log('  full        → Focus intake → [venue|menu|entertainment] → planning-team → proposal');
  console.log('  reservation → Focus (resolveFields) → availability check (custom Node) → confirmation');

  const app = express();
  // Do not tell clients which framework serves them
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));
  registerRoutes(app, chat, orchestrator, loft);

  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\nShutting down...');
    try {
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

  app.listen(env.PORT, () => {
    console.log(`\nRestaurant Agent Showcase running on http://localhost:${env.PORT} (UI at root)`);
    console.log('GET  /health                    — Health check');
    console.log('GET  /api/flows                 — List available flows');
    console.log('POST /api/sessions              — Create a session');
    console.log('POST /api/chat                  — Send a message { sessionId, message }');
    console.log('GET  /api/sessions/:id/history  — Conversation history');
    console.log('');
  });
}

main().catch(console.error);
