import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { Chat, GenerateError, SessionNotFoundError, Type } from '@moc-global/loft-definitions';
import express, { ErrorRequestHandler, Express, Response } from 'express';

import { LLM_NAME, MANIFEST_NAME } from './loft';
import { openSse, SseOptions, validateSseOptions } from './sse';
import { orderTools } from './tools';

/** The chat methods the routes use; `loft.chat` has them all */
export type AppChat = Pick<Chat.ChatInterface, 'createSession' | 'addMessages' | 'generate' | 'getChatHistory'>;

export interface AppOptions {
  /** Options of the SSE writer: heartbeat, buffer limit and what a client disconnect does */
  sse?: SseOptions;
  /** The longest message accepted, in characters. Default 4000 */
  maxMessageLength?: number;
}

export interface StreamingApp {
  app: Express;
  /**
   * For a graceful shutdown: refuses new streams, aborts the running ones (their clients get an `abort` event) and
   * waits up to `timeoutMs` for them to end. Nothing of an aborted generation is saved.
   */
  closeStreams(timeoutMs?: number): Promise<void>;
}

const DEFAULT_MAX_MESSAGE_LENGTH = 4000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The session id in its canonical (lower-case) form, or undefined when it is not a UUID */
function parseSessionId(value: unknown): string | undefined {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : undefined;
}

/** Answers an error that happened before the stream started (no `start` event, so no headers yet) as JSON. */
function sendPreflightError(res: Response, error: unknown) {
  if (error instanceof SessionNotFoundError) {
    res.status(404).json({ error: 'Session not found' });
  } else if (error instanceof GenerateError && error.status === Chat.Status.ALREADY_GENERATED) {
    res.status(409).json({ error: 'There is no new message to reply to' });
  } else {
    console.error('Chat stream error:', error);
    res.status(500).json({ error: 'Internal server error' }); // details stay in the server log
  }
}

export function createApp(chat: AppChat, options: AppOptions = {}): StreamingApp {
  // A bad SSE configuration fails here, at startup, not on the first request
  validateSseOptions(options.sse);
  const maxMessageLength = options.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH;
  // Sessions with a generation in progress. In-process only: with more than one server instance, use a distributed
  // lock (for example in Redis or PostgreSQL) instead.
  const busySessions = new Set<string>();
  // The running streams, for closeStreams(): one controller each, and a promise that settles when the route is done
  const streams = new Map<AbortController, Promise<void>>();
  let closing = false;

  const app = express();
  // Do not tell clients which framework serves them
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  // POST /sessions — Create a new chat session
  app.post('/sessions', async (_req, res) => {
    try {
      const session = await chat.createSession({
        currentLlmName: LLM_NAME,
        currentManifestName: MANIFEST_NAME,
        ctx: {}
      });
      res.json({ sessionId: session.id });
    } catch (error) {
      console.error('Session creation error:', error);
      res.status(500).json({ error: 'Internal server error' }); // details stay in the server log
    }
  });

  // POST /chat/stream — Send a message and receive the reply as Server-Sent Events
  app.post('/chat/stream', async (req, res) => {
    const body = (req.body ?? {}) as { sessionId?: unknown; message?: unknown };
    const { message } = body;

    // SECURITY: the session id is taken from the client as it is (only its format is checked). This example has no
    // authentication and does not check that the session belongs to the caller, so anyone who knows an id can write
    // to that session.
    const sessionId = parseSessionId(body.sessionId);
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId must be a UUID' });
      return;
    }
    if (typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    if (message.length > maxMessageLength) {
      res.status(400).json({ error: `message must be at most ${maxMessageLength} characters` });
      return;
    }
    if (closing) {
      res.status(503).json({ error: 'The server is shutting down' });
      return;
    }
    if (busySessions.has(sessionId)) {
      res.status(409).json({ error: 'A reply is already being generated for this session' });
      return;
    }

    const sse = openSse(res, options.sse);
    const shutdown = new AbortController();
    let settle: () => void = () => undefined;
    streams.set(
      shutdown,
      new Promise<void>((resolve) => {
        settle = resolve;
      })
    );
    // Taken directly before the try, so every path releases it
    busySessions.add(sessionId);
    let generated = false;
    try {
      const userMessage: Type.Entity.CreateMessage = {
        sessionId,
        content: [{ type: 'text', text: message }],
        role: Type.LLM.UnifiedMessageRole.user,
        author: 'user',
        llmName: LLM_NAME,
        manifestName: MANIFEST_NAME,
        ctx: {},
        llmIgnore: false
      };
      // 1. Store the user message in chat history
      await chat.addMessages(sessionId, [randomUUID()], [userMessage]);

      // 2. Generate the reply; every event becomes one SSE frame, and the headers go out with the first (`start`)
      const result = await chat.generate({
        sessionId,
        additionalTools: orderTools,
        signal: AbortSignal.any([sse.signal, shutdown.signal]),
        onEvent: (event) => sse.send(event)
      });
      generated = true;

      // 3. `finish` does not save anything: store the reply (and the tool messages) now. The stream ends after the
      // save, so a client that waits for the end can send its next message at once.
      await result.messages.save();
    } catch (error) {
      if (!res.headersSent) {
        // Nothing was streamed yet, so the error can still get a status code
        if (res.destroyed) {
          // The client is gone; nobody to answer
        } else if (shutdown.signal.aborted) {
          // closeStreams() stopped it before it started: no error to log
          res.status(503).json({ error: 'The server is shutting down' });
        } else {
          sendPreflightError(res, error);
        }
      } else if (generated) {
        // The client already has `finish`. Breaking the connection, instead of ending it cleanly, tells it that the
        // reply may not have been saved.
        console.error('Saving the reply failed:', error);
        sse.fail();
      } else if (!sse.signal.aborted && !shutdown.signal.aborted) {
        // The client already got the `error` event; an abort is no error
        console.error('Chat stream error:', error);
      }
    } finally {
      busySessions.delete(sessionId);
      sse.close();
      streams.delete(shutdown);
      settle();
    }
  });

  // GET /sessions/:id/history — View conversation history
  app.get('/sessions/:id/history', async (req, res) => {
    const sessionId = parseSessionId(req.params.id);
    if (!sessionId) {
      res.status(400).json({ error: 'The session id must be a UUID' });
      return;
    }
    try {
      const chatHistory = await chat.getChatHistory(sessionId);
      res.json({ sessionId, messages: [...chatHistory] });
    } catch (error) {
      console.error('History retrieval error:', error);
      res.status(500).json({ error: 'Internal server error' }); // details stay in the server log
    }
  });

  // Answers a body that is too large (413) or not JSON (400) as JSON instead of Express's HTML page
  const jsonErrors: ErrorRequestHandler = (error, _req, res, next) => {
    // Too late for a status code: Express's own handler then closes the connection
    if (res.headersSent) {
      next(error);
      return;
    }
    const status = typeof error?.status === 'number' && error.status < 500 ? error.status : 500;
    if (status === 500) console.error('Request error:', error);
    res.status(status).json({ error: status === 500 ? 'Internal server error' : 'Invalid request body' });
  };
  app.use(jsonErrors);

  async function closeStreams(timeoutMs = 10_000): Promise<void> {
    closing = true;
    for (const controller of streams.keys()) controller.abort(new Error('The server is shutting down'));
    const timeout = new AbortController();
    await Promise.race([
      Promise.all(streams.values()),
      delay(timeoutMs, undefined, { signal: timeout.signal }).catch(() => undefined)
    ]);
    timeout.abort();
  }

  return { app, closeStreams };
}
