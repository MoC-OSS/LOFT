import 'reflect-metadata';

import { Chat, SessionNotFoundError, Type } from '@moc-global/loft-definitions';
import crypto from 'crypto';
import express from 'express';

import { env } from './config';
import { Database, initializeDatabase } from './database';
import { initializeLoft } from './loft';

async function main() {
  console.log('Starting express-history example...');

  const db: Database = await initializeDatabase();
  console.log('PGLite database initialized (in-process, no external DB needed)');

  const { loft } = await initializeLoft(db.pool);
  const chat = loft.chat as Chat.ChatInterface;
  console.log('LOFT initialized with OpenAI gpt-4o-mini strategy');

  const app = express();
  // Do not tell clients which framework serves them
  app.disable('x-powered-by');
  app.use(express.json());

  // POST /sessions — Create a new chat session
  app.post('/sessions', async (_req, res) => {
    try {
      const session = await chat.createSession({
        currentLlmName: 'gpt-4o-mini',
        currentManifestName: 'my-assistant',
        ctx: {}
      });
      res.json({ sessionId: session.id });
    } catch (error) {
      console.error('Session creation error:', error);
      res.status(500).json({ error: 'Internal server error' }); // details stay in the server log
    }
  });

  // POST /chat — Send a message in a session (multi-turn)
  app.post('/chat', async (req, res) => {
    try {
      const { sessionId, message } = req.body as { sessionId: string; message: string };

      if (!sessionId || !message?.trim()) {
        res.status(400).json({ error: 'sessionId and message are required' });
        return;
      }

      const userMessage: Type.Entity.CreateMessage = {
        sessionId,
        content: [{ type: 'text', text: message }],
        role: Type.LLM.UnifiedMessageRole.user,
        author: 'user',
        llmName: 'gpt-4o-mini',
        manifestName: 'my-assistant',
        ctx: {},
        llmIgnore: false
      };

      // 1. Store the user message in chat history
      const correlatorId = crypto.randomUUID();
      await chat.addMessages(sessionId, [correlatorId], [userMessage]);

      // 2. Generate response — LOFT auto-loads stored history as context
      const result = await chat.generate({ sessionId });

      // 3. Save the assistant response to chat history
      await result.messages.save();

      const topChoice = result.messages.llmResponse.topChoice;
      const responseText = topChoice.content
        .filter((part): part is Type.Entity.TextContent => part.type === 'text')
        .map((part) => part.text)
        .join('');

      res.json({
        sessionId: result.sessionId,
        response: responseText,
        status: result.status
      });
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      console.error('Chat error:', error);
      res.status(500).json({ error: 'Internal server error' }); // details stay in the server log
    }
  });

  // GET /sessions/:id/history — View conversation history
  app.get('/sessions/:id/history', async (req, res) => {
    try {
      const chatHistory = await chat.getChatHistory(req.params.id);
      res.json({ sessionId: req.params.id, messages: [...chatHistory] });
    } catch (error) {
      console.error('History retrieval error:', error);
      res.status(500).json({ error: 'Internal server error' }); // details stay in the server log
    }
  });

  // Two-step graceful shutdown
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
    console.log(`express-history example running on http://localhost:${env.PORT}`);
    console.log('POST /sessions              — Create a session');
    console.log('POST /chat                  — Send a message (body: { sessionId, message })');
    console.log('GET  /sessions/:id/history  — View conversation history');
  });
}

main().catch((error) => {
  console.error('Startup failed:', error);
  process.exit(1);
});
