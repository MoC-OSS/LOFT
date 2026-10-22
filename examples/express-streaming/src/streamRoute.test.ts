import 'reflect-metadata';

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { Chat, Type } from '@moc-global/loft-definitions';
import type { ScriptedLLMStrategy } from '@moc-global/loft-test-suite';
import type { Express } from 'express';

import { AppChat, createApp } from './app';
import { Database, initializeDatabase } from './database';
import { initializeLoft } from './loft';

interface Frame {
  event: string;
  data: Record<string, unknown>;
}

/** Reads an SSE body frame by frame. Comments (`: ping`) are skipped. */
class FrameReader {
  readonly frames: Frame[] = [];
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';

  constructor(body: ReadableStream<Uint8Array>) {
    this.reader = body.getReader();
  }

  /** Reads until a frame with this event name arrives; resolves with it. */
  async until(eventName: string): Promise<Frame> {
    for (;;) {
      const found = this.frames.find((frame) => frame.event === eventName);
      if (found) return found;
      if (!(await this.readMore())) throw new Error(`The stream ended before a "${eventName}" event`);
    }
  }

  /** Reads to the end of the stream. */
  async all(): Promise<Frame[]> {
    let more = true;
    while (more) more = await this.readMore();
    return this.frames;
  }

  /** Reads the next chunk and parses the frames it completes; false at the end of the stream. */
  private async readMore(): Promise<boolean> {
    const { value, done } = await this.reader.read();
    if (done) return false;
    this.buffer += this.decoder.decode(value, { stream: true });
    const blocks = this.buffer.split('\n\n');
    this.buffer = blocks.pop() ?? '';
    for (const block of blocks.filter((b) => b && !b.startsWith(':'))) {
      const [eventLine, dataLine] = block.split('\n');
      this.frames.push({ event: eventLine.slice('event: '.length), data: JSON.parse(dataLine.slice('data: '.length)) });
    }
    return true;
  }
}

describe('POST /chat/stream', () => {
  let db: Database;
  let shutdownLoft: () => Promise<void>;
  let llm: ScriptedLLMStrategy;
  let chat: Chat.ChatInterface;
  // Every generate() call of the routes, settled, so a test can wait until a generation ended
  const generations: Promise<void>[] = [];
  const servers: Server[] = [];

  /** The LOFT chat, recording each generate() call; `overrides` replace single methods */
  const appChat = (overrides: Partial<AppChat> = {}): AppChat => ({
    createSession: (session) => chat.createSession(session),
    addMessages: (sessionId, correlatorIds, messages) => chat.addMessages(sessionId, correlatorIds, messages),
    generate: (options) => {
      const generation = chat.generate(options);
      generations.push(
        generation.then(
          () => undefined,
          () => undefined
        )
      );
      return generation;
    },
    getChatHistory: (sessionId) => chat.getChatHistory(sessionId),
    ...overrides
  });

  async function listen(app: Express): Promise<string> {
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await once(server, 'listening');
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  let baseUrl: string;

  async function createSession(url = baseUrl): Promise<string> {
    const response = await fetch(`${url}/sessions`, { method: 'POST' });
    assert.equal(response.status, 200);
    return ((await response.json()) as { sessionId: string }).sessionId;
  }

  function stream(sessionId: string, message: string, init: { url?: string; signal?: AbortSignal } = {}) {
    return fetch(`${init.url ?? baseUrl}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message }),
      signal: init.signal
    });
  }

  async function history(sessionId: string): Promise<Array<{ role: string; text: string }>> {
    const response = await fetch(`${baseUrl}/sessions/${sessionId}/history`);
    const { messages } = (await response.json()) as { messages: Type.Entity.Message[] };
    return messages.map((message) => ({
      role: message.role,
      text: message.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
    }));
  }

  async function expectJsonError(response: Response, status: number, error?: string) {
    assert.equal(response.status, status);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    const body = (await response.json()) as { error?: unknown };
    assert.equal(typeof body.error, 'string');
    if (error !== undefined) assert.equal(body.error, error);
  }

  const BUSY = 'A reply is already being generated for this session';
  const NOTHING_TO_REPLY_TO = 'There is no new message to reply to';

  before(async () => {
    // The test suite is a private, ESM-only workspace package (it imports vitest), so this CommonJS file uses import()
    const testSuite = await import('@moc-global/loft-test-suite');
    db = await initializeDatabase();
    // The scripted model takes the name of the OpenAI model, so the example's manifest serves it
    llm = new testSuite.ScriptedLLMStrategy('gpt-4o-mini');
    const { loft } = await initializeLoft(db.pool, llm);
    chat = loft.chat;
    shutdownLoft = () => loft.shutdown();
    baseUrl = await listen(createApp(appChat()).app);
  });

  after(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      server.close();
    }
    await shutdownLoft?.();
    await db?.close();
  });

  it('unknown session → JSON 404 before headers', async () => {
    const response = await stream('00000000-0000-4000-8000-000000000000', 'Hello');
    await expectJsonError(response, 404);
  });

  it('ALREADY_GENERATED → JSON 409 before headers', async () => {
    // A chat that does not store the user message, so the session has nothing to reply to
    const url = await listen(createApp(appChat({ addMessages: async () => undefined })).app);
    const sessionId = await createSession(url);

    await expectJsonError(await stream(sessionId, 'Hello', { url }), 409, NOTHING_TO_REPLY_TO);
    // The pre-flight error released the session: the same answer again, not "busy"
    await expectJsonError(await stream(sessionId, 'Hello', { url }), 409, NOTHING_TO_REPLY_TO);
  });

  it('a disconnect policy that cannot work fails at createApp', () => {
    assert.throws(() => createApp(appChat(), { sse: { onDisconnect: 'finish' } }), { message: /maxGenerationMs/ });
  });

  it('message over the length cap → 400', async () => {
    const sessionId = await createSession();
    await expectJsonError(await stream(sessionId, 'x'.repeat(4001)), 400);
    await expectJsonError(await stream(sessionId, '   '), 400);
    await expectJsonError(await stream('not-a-uuid', 'Hello'), 400, 'sessionId must be a UUID');
    await expectJsonError(await fetch(`${baseUrl}/sessions/not-a-uuid/history`), 400);
    assert.deepEqual(await history(sessionId), []);
    // An upper-case id names the same session
    assert.deepEqual(await history(sessionId.toUpperCase()), []);
  });

  it('second stream for a busy session → 409', async () => {
    const sessionId = await createSession();
    llm.script({ waitForAbort: true });
    const controller = new AbortController();
    const first = await stream(sessionId, 'Where is my order?', { signal: controller.signal });
    await new FrameReader(first.body!).until('start');

    await expectJsonError(await stream(sessionId, 'Hello again'), 409, BUSY);
    // The lock key is the canonical id, so changing the case does not get around it
    await expectJsonError(await stream(sessionId.toUpperCase(), 'Hello again'), 409, BUSY);

    controller.abort();
    await generations.at(-1);
  });

  it('tool round streams tool-call, data, tool-result, then text and finish', async () => {
    const sessionId = await createSession();
    llm.script(
      { toolCalls: [{ name: 'lookup_order', arguments: { orderId: 'A-1001' }, callId: 'call-1' }] },
      { text: 'Order A-1001 has shipped.', chunks: ['Order A-1001 ', 'has shipped.'] }
    );

    const response = await stream(sessionId, 'Where is order A-1001?');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const frames = await new FrameReader(response.body!).all();

    const names = frames.map((frame) => frame.event);
    assert.equal(names[0], 'start');
    assert.equal(names.at(-1), 'finish');
    assert.deepEqual(
      names.filter((name) => ['tool-call', 'data', 'tool-result', 'text-delta', 'finish'].includes(name)),
      ['tool-call', 'data', 'data', 'tool-result', 'text-delta', 'text-delta', 'finish']
    );

    const byEvent = (name: string) => frames.filter((frame) => frame.event === name).map((frame) => frame.data);
    assert.deepEqual(
      byEvent('data').map(({ toolName, name, data }) => ({ toolName, name, data })),
      [
        { toolName: 'lookup_order', name: 'progress', data: { stage: 'loading' } },
        { toolName: 'lookup_order', name: 'progress', data: { stage: 'done' } }
      ]
    );
    assert.equal(byEvent('tool-call')[0].name, 'lookup_order');
    assert.equal(byEvent('tool-result')[0].status, 'succeeded');
    assert.deepEqual(
      byEvent('text-delta').map((data) => data.delta),
      ['Order A-1001 ', 'has shipped.']
    );
    const [finish] = byEvent('finish');
    assert.equal(finish.text, 'Order A-1001 has shipped.');
    assert.equal('usage' in finish, false);
    // The model was offered both tools
    assert.deepEqual(llm.calls[0].toolNames.sort(), ['get_delivery_window', 'lookup_order']);
  });

  it('save() after finish', async () => {
    const sessionId = await createSession();
    llm.script({ text: 'Hello from the shop.', chunks: ['Hello ', 'from the shop.'] });

    const frames = await new FrameReader((await stream(sessionId, 'Hi')).body!).all();
    assert.equal(frames.at(-1)?.event, 'finish');

    // The stream ends after the reply was saved
    assert.deepEqual(await history(sessionId), [
      { role: 'user', text: 'Hi' },
      { role: 'assistant', text: 'Hello from the shop.' }
    ]);
  });

  it('client abort saves nothing', async () => {
    const sessionId = await createSession();
    llm.script({ text: 'Partial answer', chunks: ['Partial ', 'answer'], waitForAbortAfterChunks: true });
    const controller = new AbortController();

    const response = await stream(sessionId, 'Tell me a long story', { signal: controller.signal });
    await new FrameReader(response.body!).until('text-delta');
    controller.abort();
    await generations.at(-1);
    // Let the route finish its cleanup
    await delay(50);

    assert.deepEqual(await history(sessionId), [{ role: 'user', text: 'Tell me a long story' }]);
    // The session is free again
    llm.script({ text: 'Done.' });
    const frames = await new FrameReader((await stream(sessionId, 'Short one, please')).body!).all();
    assert.equal(frames.at(-1)?.event, 'finish');
  });

  it('a provider error after start ends with an error frame and saves nothing', async () => {
    const sessionId = await createSession();
    llm.script({ error: new Error('The provider is down') });

    const frames = await new FrameReader((await stream(sessionId, 'Hello')).body!).all();

    assert.equal(frames[0].event, 'start');
    const last = frames.at(-1);
    assert.equal(last?.event, 'error');
    assert.deepEqual(
      { code: last?.data.code, message: last?.data.message },
      { code: 'internal', message: 'Failed to generate a response.' }
    );
    assert.deepEqual(await history(sessionId), [{ role: 'user', text: 'Hello' }]);
    // The session is free again
    llm.script({ text: 'Hi there.' });
    const retry = await stream(sessionId, 'Hello?');
    assert.equal(retry.status, 200);
    assert.equal((await new FrameReader(retry.body!).all()).at(-1)?.event, 'finish');
  });

  it('a failed save after finish breaks the connection and is logged', async (t) => {
    const errorLog = t.mock.method(console, 'error', () => undefined);
    const failingSave = appChat({
      generate: async (options) => {
        const result = await chat.generate(options);
        const save = async (): Promise<Type.Entity.Message[]> => {
          throw new Error('The database is down');
        };
        return { ...result, messages: { ...result.messages, save } };
      }
    });
    const url = await listen(createApp(failingSave).app);
    const sessionId = await createSession(url);
    llm.script({ text: 'Saved? No.' });

    const reader = new FrameReader((await stream(sessionId, 'Hello', { url })).body!);
    await assert.rejects(reader.all());

    // The client got finish, but the stream broke instead of ending cleanly
    assert.equal(reader.frames.at(-1)?.event, 'finish');
    assert.ok(errorLog.mock.calls.some((call) => call.arguments[0] === 'Saving the reply failed:'));
    assert.deepEqual(await history(sessionId), [{ role: 'user', text: 'Hello' }]);
  });

  it('closeStreams before start answers 503 without logging an error', async (t) => {
    const errorLog = t.mock.method(console, 'error', () => undefined);
    let entered: () => void = () => undefined;
    const reachedAddMessages = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Holds the request in addMessages, before generate() and its start event
    const { app, closeStreams } = createApp(
      appChat({
        addMessages: async (sessionId, correlatorIds, messages) => {
          entered();
          await released;
          await chat.addMessages(sessionId, correlatorIds, messages);
        }
      })
    );
    const url = await listen(app);
    const sessionId = await createSession(url);

    const response = stream(sessionId, 'Hello', { url });
    await reachedAddMessages;
    const closed = closeStreams(5_000);
    release();
    await closed;

    await expectJsonError(await response, 503, 'The server is shutting down');
    assert.deepEqual(errorLog.mock.calls, []);
  });

  it('closeStreams aborts the running streams and refuses new ones', async () => {
    const { app, closeStreams } = createApp(appChat());
    const url = await listen(app);
    const sessionId = await createSession(url);
    llm.script({ text: 'Long answer', chunks: ['Long ', 'answer'], waitForAbortAfterChunks: true });
    const reader = new FrameReader((await stream(sessionId, 'Tell me everything', { url })).body!);
    await reader.until('text-delta');

    await closeStreams(5_000);

    const frames = await reader.all();
    assert.equal(frames.at(-1)?.event, 'abort');
    assert.deepEqual(await history(sessionId), [{ role: 'user', text: 'Tell me everything' }]);
    await expectJsonError(await stream(sessionId, 'Hello', { url }), 503, 'The server is shutting down');
  });
});
