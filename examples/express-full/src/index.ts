import 'reflect-metadata';

import { Chat, Type } from '@moc-global/loft-definitions';
import crypto from 'crypto';
import express from 'express';

import { env } from './config';
import { Database, initializeDatabase } from './database';
import { initializeLoft } from './loft';

async function main() {
  console.log('Starting express-full example...');

  const db: Database = await initializeDatabase();
  console.log('Connected to Docker PostgreSQL');

  const { loft, loftConstructor } = await initializeLoft(db.pool);
  const chat = loft.chat as Chat.ChatInterface;
  console.log('LOFT initialized with Anthropic claude-sonnet-5-5 strategy');

  const app = express();
  // Do not tell clients which framework serves them
  app.disable('x-powered-by');
  app.use(express.json());

  // GET /health — Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // POST /api/sessions — Create a new chat session
  app.post('/api/sessions', async (_req, res) => {
    try {
      const session = await chat.createSession({
        currentLlmName: 'claude-sonnet-5-5',
        currentManifestName: 'my-assistant',
        ctx: {}
      });
      res.json({ sessionId: session.id });
    } catch (error) {
      console.error('Session creation error:', error);
      res.status(500).json({ error: 'Internal server error' }); // details stay in the server log
    }
  });

  // GET /api/sessions/:id — Get session info
  app.get('/api/sessions/:id', async (req, res) => {
    try {
      const session = await chat.getSessionById(req.params.id);
      res.json(session);
    } catch (error) {
      console.error('Get session error:', error);
      res.status(500).json({ error: 'Internal server error' }); // details stay in the server log
    }
  });

  // GET /api/sessions/:id/history — The stored conversation
  app.get('/api/sessions/:id/history', async (req, res) => {
    try {
      const chatHistory = await chat.getChatHistory(req.params.id);
      res.json({ sessionId: req.params.id, messages: [...chatHistory] });
    } catch (error) {
      console.error('History retrieval error:', error);
      res.status(500).json({ error: 'Internal server error' }); // details stay in the server log
    }
  });

  // DELETE /api/sessions/:id — Delete a session
  app.delete('/api/sessions/:id', async (req, res) => {
    try {
      await chat.deleteSession(req.params.id);
      res.json({ deleted: true });
    } catch (error) {
      console.error('Delete session error:', error);
      res.status(500).json({ error: 'Internal server error' }); // details stay in the server log
    }
  });

  // POST /api/chat — Send a message in a session (multi-turn)
  app.post('/api/chat', async (req, res) => {
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
        llmName: 'claude-sonnet-5-5',
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
      console.error('Chat error:', error);
      res.status(500).json({ error: 'Internal server error' }); // details stay in the server log
    }
  });

  // Three-step graceful shutdown with re-entrancy guard
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
    console.log(`express-full example running on http://localhost:${env.PORT}`);
    console.log('GET  /health                — Health check');
    console.log('POST /api/sessions          — Create a session');
    console.log('GET  /api/sessions/:id      — Get session info');
    console.log('GET  /api/sessions/:id/history — View conversation history');
    console.log('DELETE /api/sessions/:id    — Delete a session');
    console.log('POST /api/chat              — Send a message (body: { sessionId, message })');
  });
}

main().catch(console.error);
