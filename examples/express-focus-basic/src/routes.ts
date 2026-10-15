import { Chat } from '@moc-global/loft-definitions';
import { Express } from 'express';

import { sendMessage } from './loft/chat';
import { createSession, getHistory } from './loft/session';

export const registerRoutes = (app: Express, chat: Chat.ChatInterface) => {
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/api/sessions', async (_req, res) => {
    try {
      const sessionId = await createSession(chat);
      res.json({ sessionId });
    } catch (error) {
      console.error('Session creation error:', error);
      res.status(500).json({ error: 'Internal server error' }); // details stay in the server log
    }
  });

  app.get('/api/sessions/:id/history', async (req, res) => {
    try {
      const messages = await getHistory(chat, req.params.id);
      res.json({ sessionId: req.params.id, messages });
    } catch (error) {
      console.error('Get history error:', error);
      res.status(500).json({ error: 'Internal server error' }); // details stay in the server log
    }
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const { sessionId, message } = req.body as { sessionId: string; message: string };

      if (!sessionId || !message?.trim()) {
        res.status(400).json({ error: 'sessionId and message are required' });
        return;
      }

      const result = await sendMessage(chat, sessionId, message);
      res.json(result);
    } catch (error) {
      console.error('Chat error:', error);
      res.status(500).json({ error: 'Internal server error' }); // details stay in the server log
    }
  });
};
