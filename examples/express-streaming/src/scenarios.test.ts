import 'reflect-metadata';

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { ClientRequest, IncomingMessage, request, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { after, before, describe, it, mock } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { Chat, SessionNotFoundError, Type } from '@moc-global/loft-definitions';
import type { ScriptedLLMCall, ScriptedLLMStrategy, ScriptedTurn } from '@moc-global/loft-test-suite';

import type { AppChat, AppOptions, StreamingApp } from './app';
import type { Database } from './database';

// Transport scenarios: slow and vanishing clients, concurrent sessions, odd payloads, the disconnect policies and
// shutdown, each checked against a strict SSE parser. They run offline with a scripted model and PGlite.

// LOFT's own logger is read when the app modules load (below, in before()); keep it quiet unless asked otherwise
process.env.LOFT_LOG_LEVEL ??= 'FATAL';

// Every unhandled rejection in this file is a failure; the last test checks the list
const unhandledRejections: unknown[] = [];
process.on('unhandledRejection', (reason) => {
  unhandledRejections.push(reason);
});

// ---------------------------------------------------------------------------------------------------------------
// A strict SSE parser: any frame the writer must never produce fails the test
// ---------------------------------------------------------------------------------------------------------------

const EVENT_NAMES: ReadonlySet<string> = new Set([
  'start',
  'status',
  'step-start',
  'text-delta',
  'reasoning-delta',
  'tool-call',
  'data',
  'tool-result',
  'step-finish',
  'finish',
  'error',
  'abort'
]);
const TERMINALS: ReadonlySet<string> = new Set(['finish', 'error', 'abort']);
const COMMENTS: ReadonlySet<string> = new Set([': ping', ': failed']);
// Control characters other than the line feed that separates lines: JSON escapes them, so none may appear raw
// eslint-disable-next-line no-control-regex
const RAW_CONTROL = new RegExp('[\\u0000-\\u0009\\u000b-\\u001f\\u2028\\u2029]');

interface Frame {
  event: string;
  data: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const preview = (text: string) => JSON.stringify(text.length > 160 ? `${text.slice(0, 160)}…` : text);

/** Parses one block (the text between two blank lines): a frame, or undefined for a comment. Throws otherwise. */
function parseBlock(block: string): Frame | undefined {
  assert.ok(block.length > 0, 'an empty block: a blank line that ends no frame');
  assert.ok(!block.includes('\r'), `a carriage return, which SSE clients read as a line end: ${preview(block)}`);
  if (block.startsWith(':')) {
    assert.ok(COMMENTS.has(block), `an unexpected comment: ${preview(block)}`);
    return undefined;
  }
  const lines = block.split('\n');
  assert.equal(lines.length, 2, `a frame has exactly one event line and one data line: ${preview(block)}`);
  const [eventLine, dataLine] = lines;
  const match = /^event: ([a-z-]+)$/.exec(eventLine);
  assert.ok(match, `a malformed event line: ${preview(eventLine)}`);
  const event = match[1];
  assert.ok(EVENT_NAMES.has(event), `an unknown event name: ${event}`);
  assert.ok(dataLine.startsWith('data: '), `a malformed data line: ${preview(dataLine)}`);
  const json = dataLine.slice('data: '.length);
  assert.ok(!RAW_CONTROL.test(json), `a raw control character or line separator in the data: ${preview(json)}`);
  const data: unknown = JSON.parse(json);
  assert.ok(isRecord(data), `the data line is not a JSON object: ${preview(json)}`);
  assert.equal(data.type, event, 'the event line and the type in the data disagree');
  assert.ok(Number.isInteger(data.seq), 'seq is not an integer');
  assert.equal(typeof data.runId, 'string', 'runId is not a string');
  assert.equal('usage' in data, false, 'usage must stay on the server');
  return { event, data };
}

/** Parses a whole body. With `complete`, the body must end exactly at the end of a frame. */
function parseBody(body: string, complete: boolean): { frames: Frame[]; comments: string[] } {
  const blocks = body.split('\n\n');
  const rest = blocks.pop() ?? '';
  if (complete) assert.equal(rest, '', `the body ends inside a frame: ${preview(rest)}`);
  const frames: Frame[] = [];
  const comments: string[] = [];
  for (const block of blocks) {
    const frame = parseBlock(block);
    if (frame) frames.push(frame);
    else comments.push(block);
  }
  return { frames, comments };
}

type Ending = 'clean' | 'broken';

/** Reads an SSE body from fetch frame by frame, parsing each block strictly as soon as it is complete. */
class StrictReader {
  readonly frames: Frame[] = [];
  readonly comments: string[] = [];
  /** How the body ended: `clean` at a normal end, `broken` when the connection was cut or the client aborted */
  ending: Ending | undefined;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private buffer = '';

  constructor(body: ReadableStream<Uint8Array> | null) {
    assert.ok(body, 'a streamed response has a body');
    this.reader = body.getReader();
  }

  /** Reads until a frame with this event name arrives. */
  async until(eventName: string): Promise<Frame> {
    for (;;) {
      const found = this.frames.find((frame) => frame.event === eventName);
      if (found) return found;
      if (!(await this.readMore())) throw new Error(`The stream ended (${this.ending}) before a "${eventName}" event`);
    }
  }

  /** Reads until at least `count` frames arrived or the stream ended. */
  async atLeast(count: number): Promise<void> {
    while (this.frames.length < count && (await this.readMore()));
  }

  /** Reads to the end; a cut connection ends the reading as `broken`, it does not throw. */
  async all(): Promise<Frame[]> {
    while (await this.readMore());
    return this.frames;
  }

  private async readMore(): Promise<boolean> {
    if (this.ending) return false;
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await this.reader.read();
    } catch {
      this.ending = 'broken';
      return false;
    }
    if (chunk.done) {
      this.buffer += this.decoder.decode();
      assert.equal(this.buffer, '', `the stream ended inside a frame: ${preview(this.buffer)}`);
      this.ending = 'clean';
      return false;
    }
    this.buffer += this.decoder.decode(chunk.value, { stream: true });
    const blocks = this.buffer.split('\n\n');
    this.buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const frame = parseBlock(block);
      if (frame) this.frames.push(frame);
      else this.comments.push(block);
    }
    return true;
  }
}

/**
 * Checks what every stream must keep: it opens with `start`; one runId; seq strictly increasing (without gaps unless
 * a frame was dropped on purpose); `data` only between its tool's `tool-call` and `tool-result`; at most one terminal
 * event, and it is the last. A stream that ended cleanly has its terminal event.
 */
function assertRun(frames: Frame[], ending: Ending | undefined, options: { gaps?: boolean } = {}): void {
  if (frames.length === 0) return;
  assert.equal(frames[0].event, 'start', 'the first frame is start');
  const runId = frames[0].data.runId;
  const openTools = new Set<unknown>();
  let previous = -1;
  for (const [index, frame] of frames.entries()) {
    assert.equal(frame.data.runId, runId, 'one runId per stream');
    const seq = Number(frame.data.seq);
    assert.ok(seq > previous, `seq goes up: ${previous} then ${seq}`);
    if (!options.gaps) assert.equal(seq, index, 'seq has no gaps');
    previous = seq;
    if (frame.event === 'tool-call') openTools.add(frame.data.toolCallId);
    if (frame.event === 'data') assert.ok(openTools.has(frame.data.toolCallId), 'data outside its tool call');
    if (frame.event === 'tool-result') openTools.delete(frame.data.toolCallId);
  }
  const terminals = frames.flatMap((frame, index) => (TERMINALS.has(frame.event) ? [index] : []));
  assert.ok(terminals.length <= 1, `more than one terminal event: ${terminals.length}`);
  if (terminals.length === 1) assert.equal(terminals[0], frames.length - 1, 'the terminal event is the last');
  if (ending === 'clean') assert.equal(terminals.length, 1, 'a stream that ended cleanly ends with a terminal event');
}

const named = (frames: Frame[], event: string) => frames.filter((frame) => frame.event === event);
const deltas = (frames: Frame[]) =>
  named(frames, 'text-delta')
    .map((frame) => String(frame.data.delta))
    .join('');

/** A seeded pseudo-random generator (mulberry32), so a failing iteration can be replayed */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// A client that does not read: plain node:http, the response paused as soon as it arrives
// ---------------------------------------------------------------------------------------------------------------

interface PausedResponse {
  res: IncomingMessage;
  /** Resolves when the response closed; true when it arrived complete */
  closed: Promise<boolean>;
}

function pausedPost(url: string, body: object): { req: ClientRequest; response: Promise<PausedResponse> } {
  const req = request(`${url}/chat/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  const response = new Promise<PausedResponse>((resolve, reject) => {
    req.on('response', (res) => {
      res.pause();
      res.on('error', () => undefined);
      const closed = new Promise<boolean>((resolveClosed) => res.once('close', () => resolveClosed(res.complete)));
      resolve({ res, closed });
    });
    req.on('error', reject);
  });
  req.end(JSON.stringify(body));
  return { req, response };
}

/** Starts reading a paused response and returns what arrived and whether it ended normally. */
async function drain({ res, closed }: PausedResponse): Promise<{ body: string; ending: Ending }> {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.resume();
  const complete = await closed;
  return { body: Buffer.concat(chunks).toString('utf8'), ending: complete ? 'clean' : 'broken' };
}

// ---------------------------------------------------------------------------------------------------------------

describe('SSE transport scenarios', () => {
  let db: Database;
  let llm: ScriptedLLMStrategy;
  let chat: Chat.ChatInterface;
  let createApp: (chat: AppChat, options?: AppOptions) => StreamingApp;
  let shutdownLoft: () => Promise<void>;
  let baseUrl: string;
  const servers: Server[] = [];
  const errorLog: unknown[][] = [];

  // The scripted model answers each user message from its own queue of replies, so concurrent sessions and
  // aborted runs that leave replies unused never take another scenario's reply
  const replies = new Map<string, ScriptedTurn[]>();
  let messageCount = 0;
  const dispatch = (call: ScriptedLLMCall): ScriptedTurn => {
    const lastUser = call.messages.filter((m) => m.role === Type.LLM.UnifiedMessageRole.user).at(-1);
    return replies.get(lastUser?.text ?? '')?.shift() ?? { error: new Error('No scripted reply for this message') };
  };
  /** A unique user message whose model replies are `turns` */
  function message(label: string, ...turns: ScriptedTurn[]): string {
    const text = `${label} (${++messageCount})`;
    replies.set(text, turns);
    return text;
  }

  // What the route did with the last generate() call of each session
  interface Run {
    generate: Promise<'resolved' | 'rejected'>;
    save?: Promise<'saved' | 'failed'>;
  }
  const runs = new Map<string, Run>();

  // A message that the wrapped addMessages answers with "session not found": it shows whether the session is free
  // (404) or busy (409) without starting a generation
  const PROBE = '__probe__';

  interface Knobs {
    /** Replaces the example's tools */
    tools?: Chat.AdditionalTool[];
    /** save() waits for it */
    saveGate?: Promise<void>;
    /** addMessages calls `entered`, then waits for `released` */
    addGate?: { entered: () => void; released: Promise<void> };
    /** addMessages fails with it */
    addError?: Error;
  }

  function appChat(knobs: Knobs = {}): AppChat {
    return {
      createSession: (session) => chat.createSession(session),
      addMessages: async (sessionId, correlatorIds, messages) => {
        const first = messages[0]?.content[0];
        if (first?.type === 'text' && first.text === PROBE) throw new SessionNotFoundError({ sessionId });
        if (knobs.addError) throw knobs.addError;
        if (knobs.addGate) {
          knobs.addGate.entered();
          await knobs.addGate.released;
        }
        return chat.addMessages(sessionId, correlatorIds, messages);
      },
      generate: (options) => {
        const generation = chat.generate(knobs.tools ? { ...options, additionalTools: knobs.tools } : options);
        const run: Run = {
          generate: generation.then(
            () => 'resolved',
            () => 'rejected'
          )
        };
        runs.set(options.sessionId, run);
        return generation.then((result) => {
          const save = (saveOptions?: Chat.BatchSaveOptions): Promise<Type.Entity.Message[]> => {
            const saving = (async () => {
              await knobs.saveGate;
              return result.messages.save(saveOptions);
            })();
            run.save = saving.then(
              () => 'saved',
              () => 'failed'
            );
            return saving;
          };
          return { ...result, messages: { ...result.messages, save } };
        });
      },
      getChatHistory: (sessionId) => chat.getChatHistory(sessionId)
    };
  }

  async function listen(options: AppOptions = {}, knobs: Knobs = {}) {
    const streamingApp = createApp(appChat(knobs), options);
    const server = streamingApp.app.listen(0, '127.0.0.1');
    servers.push(server);
    await once(server, 'listening');
    return {
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      closeStreams: streamingApp.closeStreams
    };
  }

  async function createSession(url = baseUrl): Promise<string> {
    const response = await fetch(`${url}/sessions`, { method: 'POST' });
    assert.equal(response.status, 200);
    return ((await response.json()) as { sessionId: string }).sessionId;
  }

  function post(url: string, sessionId: string, text: string, signal?: AbortSignal) {
    return fetch(`${url}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: text }),
      signal
    });
  }

  async function history(sessionId: string): Promise<Array<{ role: string; text: string }>> {
    const messages = await chat.getChatHistory(sessionId);
    return [...messages].map((m) => ({
      role: m.role,
      text: m.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
    }));
  }

  /** 404 when the session's lock is free, 409 while a generation holds it */
  async function probe(url: string, sessionId: string): Promise<number> {
    const response = await post(url, sessionId, PROBE);
    await response.arrayBuffer();
    return response.status;
  }

  /** Waits until the route released the session (the route's cleanup ran); fails after `timeoutMs` */
  async function waitUntilFree(url: string, sessionId: string, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const status = await probe(url, sessionId);
      if (status === 404) return;
      assert.equal(status, 409, `unexpected probe status ${status}`);
      assert.ok(Date.now() < deadline, 'the session lock was never released');
      await delay(10);
    }
  }

  /** The route's own console.error calls since `from`, by their first argument */
  const routeErrors = (from: number) => errorLog.slice(from).map((args) => String(args[0]));

  before(async () => {
    // Loaded here, after the log level is set; the test suite is ESM only, so it is loaded with import() too
    const testSuite = await import('@moc-global/loft-test-suite');
    const appModule = await import('./app');
    const databaseModule = await import('./database');
    const loftModule = await import('./loft');
    createApp = appModule.createApp;

    mock.method(console, 'error', (...args: unknown[]) => {
      errorLog.push(args);
    });
    mock.method(console, 'log', () => undefined);

    db = await databaseModule.initializeDatabase();
    llm = new testSuite.ScriptedLLMStrategy('gpt-4o-mini');
    llm.script(...Array.from({ length: 3000 }, () => dispatch));
    const { loft } = await loftModule.initializeLoft(db.pool, llm);
    chat = loft.chat;
    shutdownLoft = () => loft.shutdown();
    baseUrl = (await listen()).url;
  });

  after(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      server.close();
    }
    await shutdownLoft?.();
    await db?.close();
    mock.restoreAll();
  });

  // -------------------------------------------------------------------------------------------------------------
  // Frames
  // -------------------------------------------------------------------------------------------------------------

  it('frames stay well-formed with a heartbeat every few milliseconds during a tool round', async () => {
    const { url } = await listen({ sse: { heartbeatMs: 2 } });
    const sessionId = await createSession(url);
    const reply = 'Order A-1001 has shipped to Lviv.';
    const text = message(
      'Where is order A-1001?',
      { toolCalls: [{ name: 'lookup_order', arguments: { orderId: 'A-1001' } }] },
      { text: reply, chunks: ['Order ', 'A-1001 ', 'has shipped ', 'to Lviv.'], chunkDelayMs: 5 }
    );

    const response = await post(url, sessionId, text);
    assert.equal(response.status, 200);
    const reader = new StrictReader(response.body);
    const frames = await reader.all();

    assert.equal(reader.ending, 'clean');
    assertRun(frames, reader.ending);
    assert.equal(frames.at(-1)?.event, 'finish');
    assert.ok(reader.comments.length >= 20, `pings between the frames: ${reader.comments.length}`);
    assert.deepEqual(
      named(frames, 'data').map((frame) => frame.data.data),
      [{ stage: 'loading' }, { stage: 'done' }]
    );
    assert.equal(deltas(frames), reply);
    assert.equal(frames.at(-1)?.data.text, reply);
    assert.deepEqual((await history(sessionId)).at(-1), { role: 'assistant', text: reply });
    await waitUntilFree(url, sessionId);
  });

  it('a delta with every control character and both line separators arrives intact', async () => {
    const control = Array.from({ length: 0x20 }, (_, code) => String.fromCharCode(code))
      .filter((char) => char !== '\u0000')
      .join('');
    const c1 = Array.from({ length: 0x20 }, (_, code) => String.fromCharCode(0x80 + code)).join('');
    const tricky = [
      `a${control}b`,
      `\u007f${c1}\u2028\u2029\ufeff`,
      'event: finish\ndata: {"type":"finish"}\n\n',
      ': ping\n\nretry: 1\r\nid: 7\r\r',
      // A surrogate pair split across two deltas
      'smile \ud83d',
      '\ude00 done'
    ];
    const reply = tricky.join('');
    const { url } = await listen();
    const sessionId = await createSession(url);
    const text = message('Send me odd characters', { text: reply, chunks: tricky });

    const response = await post(url, sessionId, text);
    const reader = new StrictReader(response.body);
    const frames = await reader.all();

    assert.equal(reader.ending, 'clean');
    assertRun(frames, reader.ending);
    assert.deepEqual(
      named(frames, 'text-delta').map((frame) => frame.data.delta),
      tricky
    );
    assert.equal(frames.at(-1)?.data.text, reply);
    assert.deepEqual((await history(sessionId)).at(-1), { role: 'assistant', text: reply });
  });

  it(
    'a reply with a NUL character streams intact and is saved',
    { todo: 'the chat-history repository cannot store U+0000, a limit outside this example' },
    async () => {
      const reply = 'before\u0000after';
      const { url } = await listen();
      const sessionId = await createSession(url);
      const text = message('Send me a NUL', { text: reply, chunks: ['before', '\u0000after'] });
      const from = errorLog.length;

      const reader = new StrictReader((await post(url, sessionId, text)).body);
      const frames = await reader.all();
      assertRun(frames, reader.ending);
      assert.equal(frames.at(-1)?.event, 'finish');
      assert.equal(frames.at(-1)?.data.text, reply);

      // The stream is honest either way: a clean end means saved, a cut one means not saved
      await waitUntilFree(url, sessionId);
      const saved = (await history(sessionId)).at(-1);
      if (reader.ending === 'clean') assert.deepEqual(saved, { role: 'assistant', text: reply });
      else assert.deepEqual(routeErrors(from), ['Saving the reply failed:']);
      // What a user wants: the reply is kept
      assert.equal(reader.ending, 'clean', 'the reply was not saved');
    }
  );

  it('a tool data payload that cannot be serialised is dropped, the rest of the stream goes on', async () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 100_000; i++) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    let late: Promise<void> = Promise.resolve();
    const inspect: Chat.AdditionalTool = {
      definition: {
        name: 'inspect_payloads',
        description: 'Emits odd data payloads',
        inputSchema: { type: Chat.AdditionalToolSchemaType.OBJECT, properties: {} }
      },
      async handler(_args, context) {
        context?.emit('bigint', { value: BigInt(10) });
        context?.emit('cycle', cycle);
        context?.emit('throwing-toJSON', {
          toJSON() {
            throw new Error('no JSON');
          }
        });
        context?.emit('throwing-getter', {
          get value(): string {
            throw new Error('no value');
          }
        });
        context?.emit('deep', deep);
        context?.emit('undefined', undefined);
        context?.emit('function', () => 1);
        context?.emit('symbol', Symbol('s'));
        context?.emit('injection', { toJSON: () => 'x\n\nevent: finish\ndata: {}\n\n' });
        context?.emit('ok', { stage: 'done' });
        // After the tool finished: must be a no-op
        late = delay(1).then(() => context?.emit('late', { after: 'result' }));
        return { content: [{ type: Chat.AdditionalToolContentType.TEXT, text: '{"status":"inspected"}' }] };
      }
    };
    const { url } = await listen({}, { tools: [inspect] });
    const sessionId = await createSession(url);
    const text = message(
      'Inspect the payloads',
      { toolCalls: [{ name: 'inspect_payloads', arguments: {} }] },
      { text: 'Inspected.', chunks: ['Inspected.'], chunkDelayMs: 20 }
    );

    const reader = new StrictReader((await post(url, sessionId, text)).body);
    const frames = await reader.all();
    await late;

    assert.equal(reader.ending, 'clean');
    // Five frames were dropped, so seq has gaps
    assertRun(frames, reader.ending, { gaps: true });
    const data = named(frames, 'data');
    assert.deepEqual(
      data.map((frame) => frame.data.name),
      ['undefined', 'function', 'symbol', 'injection', 'ok']
    );
    // An undefined, function or symbol payload has no `data` field at all
    assert.equal('data' in data[0].data, false);
    assert.equal(data[3].data.data, 'x\n\nevent: finish\ndata: {}\n\n');
    const lastSeq = Number(frames.at(-1)?.data.seq);
    assert.equal(lastSeq - (frames.length - 1), 5, 'exactly the five unserialisable payloads were dropped');
    assert.equal(named(frames, 'tool-result')[0].data.status, 'succeeded');
    assert.equal(frames.at(-1)?.event, 'finish');
    // Data is never saved
    const saved = JSON.stringify(await history(sessionId));
    assert.ok(!saved.includes('stage') && !saved.includes('after'), 'no data payload in the history');
  });

  // -------------------------------------------------------------------------------------------------------------
  // Slow readers and big frames
  // -------------------------------------------------------------------------------------------------------------

  it('a client that stops reading is cut off at the buffer limit, nothing is saved and the lock is released', async () => {
    const { url } = await listen({ sse: { maxBufferedBytes: 64 * 1024 } });
    const sessionId = await createSession(url);
    const piece = 'x'.repeat(8 * 1024);
    const chunks = Array.from({ length: 200 }, () => piece);
    const text = message('Tell me everything', { text: chunks.join(''), chunks, chunkDelayMs: 1 });
    const from = errorLog.length;

    const client = pausedPost(url, { sessionId, message: text });
    const paused = await client.response;
    await waitUntilFree(url, sessionId);

    assert.equal(await runs.get(sessionId)?.generate, 'rejected');
    assert.deepEqual(await history(sessionId), [{ role: 'user', text }]);
    assert.deepEqual(routeErrors(from), [], 'a slow client is no error to log');
    const { body, ending } = await drain(paused);
    assert.equal(ending, 'broken');
    // What arrived is a well-formed prefix
    assertRun(parseBody(body, false).frames, ending);
    client.req.destroy();
  });

  it('a client that pauses and then reads gets the whole stream', async () => {
    const { url } = await listen({ sse: { maxBufferedBytes: 256 * 1024 } });
    const sessionId = await createSession(url);
    const chunks = Array.from({ length: 100 }, (_, i) => `${i}:${'y'.repeat(1024)}`);
    const reply = chunks.join('');
    const text = message('Tell me a lot', { text: reply, chunks, chunkDelayMs: 1 });

    const client = pausedPost(url, { sessionId, message: text });
    const paused = await client.response;
    await delay(300);
    const { body, ending } = await drain(paused);

    assert.equal(ending, 'clean');
    const { frames } = parseBody(body, true);
    assertRun(frames, ending);
    assert.equal(deltas(frames), reply);
    assert.equal(frames.at(-1)?.data.text, reply);
    assert.deepEqual((await history(sessionId)).at(-1), { role: 'assistant', text: reply });
  });

  it('a fast client gets a single delta bigger than the buffer limit', async () => {
    const { url } = await listen();
    const sessionId = await createSession(url);
    const huge = 'Ünïcødé ✓ '.repeat(220 * 1024); // about 2.2 million characters
    const text = message('One huge delta', { text: huge, chunks: [huge] });

    // The headers and start wait in the same buffer as the huge frame, so a cut can drop the whole response
    const response = await post(url, sessionId, text).catch(() => undefined);
    const reader = response && new StrictReader(response.body);
    const frames = (await reader?.all()) ?? [];
    assertRun(frames, reader?.ending);
    await waitUntilFree(url, sessionId);
    const generated = await runs.get(sessionId)?.generate;
    // Client and server agree: a client that got nothing means nothing was saved
    if (!response) assert.deepEqual(await history(sessionId), [{ role: 'user', text }]);
    assert.deepEqual(
      { status: response?.status, ending: reader?.ending, generated },
      { status: 200, ending: 'clean', generated: 'resolved' }
    );
    assert.equal(deltas(frames), huge);
    assert.equal((await history(sessionId)).at(-1)?.text, huge);
  });

  it('a fast client gets the finish frame of a reply longer than the buffer limit', async () => {
    const { url } = await listen({ sse: { maxBufferedBytes: 64 * 1024 } });
    const sessionId = await createSession(url);
    const chunks = Array.from({ length: 100 }, (_, i) => `${i}:${'z'.repeat(1024)}`);
    const reply = chunks.join('');
    const text = message('A long reply, read fast', { text: reply, chunks, chunkDelayMs: 1 });

    const reader = new StrictReader((await post(url, sessionId, text)).body);
    const frames = await reader.all();
    assertRun(frames, reader.ending);
    await waitUntilFree(url, sessionId);
    const run = runs.get(sessionId);
    const outcome = { ending: reader.ending, generate: await run?.generate, save: await run?.save };
    // Whatever happens, client and server must agree: a cut stream means nothing was saved
    if (reader.ending === 'broken') assert.deepEqual(await history(sessionId), [{ role: 'user', text }]);
    assert.deepEqual(outcome, { ending: 'clean', generate: 'resolved', save: 'saved' });
    assert.equal(frames.at(-1)?.data.text, reply);
  });

  // -------------------------------------------------------------------------------------------------------------
  // Disconnects
  // -------------------------------------------------------------------------------------------------------------

  it('client disconnects at random points never leave the lock taken, a half reply saved, or an error logged', async (t) => {
    // SCENARIO_SEED replays or explores other disconnect points
    const seed = Number(process.env.SCENARIO_SEED ?? 0x5eed);
    const random = prng(seed);
    const outcomes = { seed, saved: 0, aborted: 0, beforeRoute: 0 };
    for (let iteration = 0; iteration < 24; iteration++) {
      const sessionId = await createSession();
      const words = Array.from({ length: 3 + Math.floor(random() * 6) }, (_, i) => `w${i} `);
      const reply = words.join('');
      const chunkDelayMs = 2 + Math.floor(random() * 6);
      const withTool = random() < 0.4;
      const turns: ScriptedTurn[] = withTool
        ? [
            { toolCalls: [{ name: 'get_delivery_window', arguments: { city: 'Lviv' } }] },
            { text: reply, chunks: words, chunkDelayMs }
          ]
        : [{ text: reply, chunks: words, chunkDelayMs }];
      const text = message(`Random disconnect ${iteration}`, ...turns);
      const byFrames = random() < 0.6;
      const at = byFrames ? Math.floor(random() * (words.length + (withTool ? 12 : 6))) : Math.floor(random() * 60);
      const from = errorLog.length;

      const controller = new AbortController();
      let reader: StrictReader | undefined;
      if (byFrames) {
        const response = await post(baseUrl, sessionId, text, controller.signal);
        reader = new StrictReader(response.body);
        await reader.atLeast(at);
        controller.abort();
      } else {
        setTimeout(() => controller.abort(), at);
        const response = await post(baseUrl, sessionId, text, controller.signal).catch(() => undefined);
        if (response) {
          reader = new StrictReader(response.body);
          await reader.all();
        }
      }
      const label = `iteration ${iteration} (${byFrames ? 'frames' : 'ms'} ${at}, tool ${withTool})`;

      await waitUntilFree(baseUrl, sessionId);
      if (reader) assertRun(reader.frames, reader.ending);
      const run = runs.get(sessionId);
      const saved = await history(sessionId);
      if (!run) {
        // The request never reached the route
        assert.ok(saved.length <= 1, label);
        outcomes.beforeRoute++;
      } else if ((await run.generate) === 'resolved') {
        assert.equal(await run.save, 'saved', label);
        assert.deepEqual(saved.at(-1), { role: 'assistant', text: reply }, label);
        outcomes.saved++;
      } else {
        assert.deepEqual(saved, [{ role: 'user', text }], label);
        assert.ok(!reader?.frames.some((frame) => frame.event === 'finish'), `${label}: finish but nothing saved`);
        outcomes.aborted++;
      }
      assert.deepEqual(routeErrors(from), [], `${label}: a disconnect is no error to log`);
    }
    t.diagnostic(`outcomes: ${JSON.stringify(outcomes)}`);
  });

  it('a disconnect after finish, while the reply is being saved, still saves it and logs nothing', async () => {
    let release: () => void = () => undefined;
    const saveGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { url } = await listen({}, { saveGate });
    const sessionId = await createSession(url);
    const text = message('Leave during the save', { text: 'Kept.', chunks: ['Kept.'] });
    const from = errorLog.length;

    const controller = new AbortController();
    const reader = new StrictReader((await post(url, sessionId, text, controller.signal)).body);
    await reader.until('finish');
    controller.abort();
    await delay(20);
    assert.equal(await probe(url, sessionId), 409, 'busy until the save ended');
    release();
    await waitUntilFree(url, sessionId);

    assert.equal(await runs.get(sessionId)?.save, 'saved');
    assert.deepEqual((await history(sessionId)).at(-1), { role: 'assistant', text: 'Kept.' });
    assert.deepEqual(routeErrors(from), []);
  });

  it('a disconnect while the user message is being stored is no error, and the lock is released', async () => {
    let entered: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { url } = await listen({}, { addGate: { entered: () => entered(), released } });
    const sessionId = await createSession(url);
    const text = message('Gone before start', { text: 'Never sent.' });
    const from = errorLog.length;

    const controller = new AbortController();
    const response = post(url, sessionId, text, controller.signal).catch(() => undefined);
    await reached;
    controller.abort();
    await response;
    await delay(20);
    release();
    await waitUntilFree(url, sessionId);

    assert.equal(await runs.get(sessionId)?.generate, 'rejected');
    assert.deepEqual(await history(sessionId), [{ role: 'user', text }]);
    assert.deepEqual(routeErrors(from), [], 'a client that left is no error to log');
  });

  it("with onDisconnect 'finish' the reply is saved after the client left, and the session stays busy until then", async () => {
    const { url } = await listen({ sse: { onDisconnect: 'finish', maxGenerationMs: 5_000, heartbeatMs: 5 } });
    const sessionId = await createSession(url);
    const reply = 'Order A-1001 has shipped.';
    const text = message(
      'Where is A-1001? (finish policy)',
      { toolCalls: [{ name: 'lookup_order', arguments: { orderId: 'A-1001' } }] },
      { text: reply, chunks: ['Order A-1001 ', 'has shipped.'], chunkDelayMs: 20 }
    );
    const from = errorLog.length;

    const controller = new AbortController();
    const reader = new StrictReader((await post(url, sessionId, text, controller.signal)).body);
    await reader.until('tool-call');
    controller.abort();

    // The tool still runs (300 ms): a second message is refused
    await delay(30);
    assert.equal(await probe(url, sessionId), 409);
    await waitUntilFree(url, sessionId);

    assert.equal(await runs.get(sessionId)?.save, 'saved');
    assert.deepEqual((await history(sessionId)).at(-1), { role: 'assistant', text: reply });
    assert.deepEqual(routeErrors(from), []);
  });

  it("with onDisconnect 'finish' the deadline still ends a generation nobody reads, and nothing is saved", async () => {
    const { url } = await listen({ sse: { onDisconnect: 'finish', maxGenerationMs: 400 } });
    const sessionId = await createSession(url);
    const text = message('Hang after the first words', {
      text: 'First words',
      chunks: ['First ', 'words'],
      waitForAbortAfterChunks: true
    });
    const from = errorLog.length;

    const controller = new AbortController();
    const reader = new StrictReader((await post(url, sessionId, text, controller.signal)).body);
    await reader.until('text-delta');
    controller.abort();
    await delay(100);
    assert.equal(await probe(url, sessionId), 409, 'still running before the deadline');
    await waitUntilFree(url, sessionId);

    assert.equal(await runs.get(sessionId)?.generate, 'rejected');
    assert.deepEqual(await history(sessionId), [{ role: 'user', text }]);
    assert.deepEqual(routeErrors(from), []);
  });

  it("with onDisconnect 'finish' a client that stays connected past the deadline gets abort and a clean end", async () => {
    const { url } = await listen({ sse: { onDisconnect: 'finish', maxGenerationMs: 200 } });
    const sessionId = await createSession(url);
    const text = message('Hang while I watch', { text: 'Hi', chunks: ['Hi'], waitForAbortAfterChunks: true });

    const reader = new StrictReader((await post(url, sessionId, text)).body);
    const frames = await reader.all();

    assert.equal(reader.ending, 'clean');
    assertRun(frames, reader.ending);
    assert.equal(frames.at(-1)?.event, 'abort');
    await waitUntilFree(url, sessionId);
    assert.deepEqual(await history(sessionId), [{ role: 'user', text }]);
  });

  // -------------------------------------------------------------------------------------------------------------
  // Sessions and the lock
  // -------------------------------------------------------------------------------------------------------------

  it('four sessions streaming at once never mix their frames', async () => {
    const sessions = await Promise.all([0, 1, 2, 3].map(() => createSession()));
    const plans = sessions.map((sessionId, i) => {
      const words = Array.from({ length: 6 }, (_, w) => `s${i}w${w} `);
      const reply = words.join('');
      const turns: ScriptedTurn[] =
        i % 2 === 0
          ? [
              { toolCalls: [{ name: 'lookup_order', arguments: { orderId: `A-${i}` } }] },
              { text: reply, chunks: words, chunkDelayMs: 3 + i }
            ]
          : [{ text: reply, chunks: words, chunkDelayMs: 3 + i }];
      return { sessionId, reply, text: message(`Session ${i}`, ...turns) };
    });

    const results = await Promise.all(
      plans.map(async (plan) => {
        const reader = new StrictReader((await post(baseUrl, plan.sessionId, plan.text)).body);
        return { plan, frames: await reader.all(), ending: reader.ending };
      })
    );

    for (const { plan, frames, ending } of results) {
      assert.equal(ending, 'clean');
      assertRun(frames, ending);
      assert.equal(frames[0].data.sessionId, plan.sessionId);
      assert.equal(deltas(frames), plan.reply);
      assert.equal(frames.at(-1)?.data.text, plan.reply);
      assert.deepEqual((await history(plan.sessionId)).at(-1), { role: 'assistant', text: plan.reply });
    }
    assert.equal(new Set(results.map(({ frames }) => frames[0].data.runId)).size, 4, 'one runId per stream');
  });

  it('a burst of requests for one session starts exactly one stream; the others get 409', async () => {
    const sessionId = await createSession();
    const texts = Array.from({ length: 12 }, (_, i) =>
      message(`Burst ${i}`, { text: `Reply ${i}`, chunks: ['Reply ', `${i}`], chunkDelayMs: 30 })
    );

    const responses = await Promise.all(texts.map((text) => post(baseUrl, sessionId, text)));
    const accepted = responses.flatMap((response, i) => (response.status === 200 ? [i] : []));
    assert.equal(accepted.length, 1, `statuses: ${responses.map((r) => r.status).join(',')}`);
    for (const [i, response] of responses.entries()) {
      if (i === accepted[0]) continue;
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: 'A reply is already being generated for this session' });
    }
    const winner = accepted[0];
    const reader = new StrictReader(responses[winner].body);
    const frames = await reader.all();
    assertRun(frames, reader.ending);
    assert.deepEqual(await history(sessionId), [
      { role: 'user', text: texts[winner] },
      { role: 'assistant', text: `Reply ${winner}` }
    ]);
  });

  it('a client that waits for the end of each stream can send the next message at once, eight times in a row', async () => {
    const sessionId = await createSession();
    const expected: Array<{ role: string; text: string }> = [];
    for (let turn = 0; turn < 8; turn++) {
      const reply = `Answer ${turn}`;
      const text = message(`Turn ${turn}`, { text: reply, chunks: ['Answer ', `${turn}`] });
      const response = await post(baseUrl, sessionId, text);
      assert.equal(response.status, 200, `turn ${turn}`);
      const reader = new StrictReader(response.body);
      const frames = await reader.all();
      assertRun(frames, reader.ending);
      assert.equal(frames.at(-1)?.event, 'finish');
      expected.push({ role: 'user', text }, { role: 'assistant', text: reply });
    }
    assert.deepEqual(await history(sessionId), expected);
  });

  it('a provider error after some deltas ends with error, saves nothing and frees the session', async () => {
    const sessionId = await createSession();
    const text = message('Fail midway', {
      text: 'Half an',
      chunks: ['Half ', 'an'],
      failAfterChunks: new Error('The provider dropped the stream')
    });

    const reader = new StrictReader((await post(baseUrl, sessionId, text)).body);
    const frames = await reader.all();

    assert.equal(reader.ending, 'clean');
    assertRun(frames, reader.ending);
    assert.equal(frames.at(-1)?.event, 'error');
    assert.equal(deltas(frames), 'Half an');
    await waitUntilFree(baseUrl, sessionId);
    assert.deepEqual(await history(sessionId), [{ role: 'user', text }]);
  });

  it('a failure while storing the user message answers 500 as JSON and frees the session', async () => {
    const { url } = await listen({}, { addError: new Error('The database is down') });
    const sessionId = await createSession(url);
    const from = errorLog.length;

    const response = await post(url, sessionId, message('Store me'));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Internal server error' });
    assert.deepEqual(routeErrors(from), ['Chat stream error:']);
    await waitUntilFree(url, sessionId);
  });

  // -------------------------------------------------------------------------------------------------------------
  // Shutdown
  // -------------------------------------------------------------------------------------------------------------

  it('closeStreams during a tool run aborts it at once and the client gets abort', async () => {
    const { url, closeStreams } = await listen();
    const sessionId = await createSession(url);
    const text = message(
      'Look up A-7 (shutdown)',
      { toolCalls: [{ name: 'lookup_order', arguments: { orderId: 'A-7' } }] },
      { text: 'Never.' }
    );
    const reader = new StrictReader((await post(url, sessionId, text)).body);
    await reader.until('tool-call');

    const started = Date.now();
    await closeStreams(5_000);
    const elapsed = Date.now() - started;
    const frames = await reader.all();

    assert.ok(elapsed < 250, `the tool's wait was cancelled: ${elapsed} ms`);
    assert.equal(reader.ending, 'clean');
    assertRun(frames, reader.ending);
    assert.equal(frames.at(-1)?.event, 'abort');
    assert.deepEqual(await history(sessionId), [{ role: 'user', text }]);
  });

  it('closeStreams waits for a save in progress, and that client still gets finish and a clean end', async () => {
    let release: () => void = () => undefined;
    const saveGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { url, closeStreams } = await listen({}, { saveGate });
    const sessionId = await createSession(url);
    const text = message('Save during shutdown', { text: 'Saved anyway.' });
    const reader = new StrictReader((await post(url, sessionId, text)).body);
    await reader.until('finish');

    const started = Date.now();
    const closed = closeStreams(5_000);
    setTimeout(release, 100);
    await closed;

    assert.ok(Date.now() - started >= 90, 'closeStreams waited for the save');
    const frames = await reader.all();
    assert.equal(reader.ending, 'clean');
    assertRun(frames, reader.ending);
    assert.equal(frames.at(-1)?.event, 'finish');
    assert.deepEqual((await history(sessionId)).at(-1), { role: 'assistant', text: 'Saved anyway.' });
  });

  it('closeStreams gives up after its timeout while a save hangs; the stream ends when the save does', async () => {
    let release: () => void = () => undefined;
    const saveGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { url, closeStreams } = await listen({}, { saveGate });
    const sessionId = await createSession(url);
    const text = message('Slow save during shutdown', { text: 'Late but saved.' });
    const reader = new StrictReader((await post(url, sessionId, text)).body);
    await reader.until('finish');

    const started = Date.now();
    await closeStreams(100);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 90 && elapsed < 1_000, `closeStreams returned after its timeout: ${elapsed} ms`);
    assert.equal(reader.ending, undefined, 'the stream is still open');

    release();
    const frames = await reader.all();
    assert.equal(reader.ending, 'clean');
    assertRun(frames, reader.ending);
    assert.deepEqual((await history(sessionId)).at(-1), { role: 'assistant', text: 'Late but saved.' });
  });

  it('closeStreams with four live streams and a client that does not read: all end, twice-called, then 503', async () => {
    const { url, closeStreams } = await listen({ sse: { heartbeatMs: 5 } });
    const sessions = await Promise.all([0, 1, 2, 3, 4].map(() => createSession(url)));
    const readers = await Promise.all(
      sessions.slice(0, 4).map(async (sessionId, i) => {
        const text = message(
          `Shutdown stream ${i}`,
          i === 0
            ? { toolCalls: [{ name: 'lookup_order', arguments: { orderId: 'A-9' } }] }
            : { text: 'Going on', chunks: ['Going ', 'on'], waitForAbortAfterChunks: true }
        );
        const reader = new StrictReader((await post(url, sessionId, text)).body);
        await reader.until(i === 0 ? 'tool-call' : 'text-delta');
        return { sessionId, text, reader };
      })
    );
    const slowText = message('Shutdown, not reading', {
      text: 'Going on',
      chunks: ['Going ', 'on'],
      waitForAbortAfterChunks: true
    });
    const slow = pausedPost(url, { sessionId: sessions[4], message: slowText });
    const paused = await slow.response;

    const started = Date.now();
    await Promise.all([closeStreams(5_000), closeStreams(5_000)]);
    assert.ok(Date.now() - started < 1_000, 'closeStreams did not wait for the slow client');

    for (const { sessionId, text, reader } of readers) {
      const frames = await reader.all();
      assert.equal(reader.ending, 'clean');
      assertRun(frames, reader.ending);
      assert.equal(frames.at(-1)?.event, 'abort');
      assert.deepEqual(await history(sessionId), [{ role: 'user', text }]);
    }
    const { body, ending } = await drain(paused);
    assert.equal(ending, 'clean');
    const { frames } = parseBody(body, true);
    assertRun(frames, ending);
    assert.equal(frames.at(-1)?.event, 'abort');
    assert.deepEqual(await history(sessions[4]), [{ role: 'user', text: slowText }]);

    const refused = await post(url, sessions[0], message('After shutdown'));
    assert.equal(refused.status, 503);
    assert.deepEqual(await refused.json(), { error: 'The server is shutting down' });
  });

  it("closeStreams ends a generation that runs on after its client left (onDisconnect 'finish'); nothing is saved", async () => {
    const { url, closeStreams } = await listen({ sse: { onDisconnect: 'finish', maxGenerationMs: 10_000 } });
    const sessionId = await createSession(url);
    const text = message('Left, then shutdown', { text: 'Hi', chunks: ['Hi'], waitForAbortAfterChunks: true });
    const controller = new AbortController();
    const reader = new StrictReader((await post(url, sessionId, text, controller.signal)).body);
    await reader.until('text-delta');
    controller.abort();
    await delay(20);

    const started = Date.now();
    await closeStreams(5_000);
    assert.ok(Date.now() - started < 1_000);
    assert.equal(await runs.get(sessionId)?.generate, 'rejected');
    assert.deepEqual(await history(sessionId), [{ role: 'user', text }]);
  });

  // -------------------------------------------------------------------------------------------------------------

  it('no unhandled promise rejection in any scenario', async () => {
    // Late rejections of aborted work surface on the next turns of the event loop
    await delay(100);
    assert.deepEqual(unhandledRejections, []);
  });
});
