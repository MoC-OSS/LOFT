import 'reflect-metadata';

import { Type } from '@moc-global/loft-definitions';
import crypto from 'crypto';
import express from 'express';

import { env } from './config';
import { Database, initializeDatabase } from './database';
import { initializeLoft } from './loft';

async function main() {
  console.log('Starting express-basic example...');

  const db: Database = await initializeDatabase();
  console.log('PGLite database initialized (in-process, no external DB needed)');

  const { loft, loftConstructor } = await initializeLoft(db.pool);
  console.log('LOFT initialized with OpenAI gpt-4o-mini strategy');

  const app = express();
  // Do not tell clients which framework serves them
  app.disable('x-powered-by');
  app.use(express.json());

  app.post('/chat', async (req, res) => {
    try {
      const { message } = req.body as { message: string };

      if (!message) {
        res.status(400).json({ error: 'message is required' });
        return;
      }

      // Create an ephemeral session for this single-turn request
      const session = await loft.chat.createSession({
        currentLlmName: 'gpt-4o-mini',
        currentManifestName: 'my-assistant',
        ctx: {},
        externalKey: { requestId: crypto.randomUUID() }
      });

      // Send the user message and get LLM response
      const result = await loft.chat.generate({
        sessionId: session.id,
        directMessages: [
          {
            sessionId: session.id,
            content: [{ type: 'text', text: message }],
            role: Type.LLM.UnifiedMessageRole.user,
            author: 'user',
            llmName: 'gpt-4o-mini',
            manifestName: 'my-assistant',
            ctx: {},
            llmIgnore: false
          }
        ]
      });

      // Extract text from the LLM response
      const topChoice = result.messages.llmResponse.topChoice;
      const responseText = topChoice.content
        .filter((part): part is Type.Entity.TextContent => part.type === 'text')
        .map((part) => part.text)
        .join('');

      // Clean up the ephemeral session
      await loft.chat.deleteSession(session.id);

      res.json({ response: responseText });
    } catch (error) {
      console.error('Chat error:', error);
      res.status(500).json({ error: 'Internal server error' }); // details stay in the server log
    }
  });

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
    console.log(`express-basic example running on http://localhost:${env.PORT}`);
    console.log('POST /chat — Send { "message": "..." } to chat with the LLM');
  });
}

main().catch(console.error);
