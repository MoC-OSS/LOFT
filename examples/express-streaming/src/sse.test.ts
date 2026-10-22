import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, IncomingMessage, request, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { Chat } from '@moc-global/loft-definitions';

import { openSse, SseOptions, SseStream } from './sse';

// An event without the fields every event shares
type EventBody = Chat.ChatStreamEvent extends infer E
  ? E extends Chat.ChatStreamEvent
    ? Omit<E, 'seq' | 'runId' | 'source'>
    : never
  : never;

let seq = 0;
const event = (body: EventBody): Chat.ChatStreamEvent =>
  ({ seq: seq++, runId: 'run-1', ...body }) as Chat.ChatStreamEvent;

const start = () => event({ type: 'start', sessionId: 's-1', textPolicy: 'all', streaming: true });
const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15, model: 'gpt-4o-mini', finishReason: 'stop' };

interface Frame {
  event: string;
  data: Record<string, unknown>;
}

/** Splits a body into frames; comments (`: ping`) are left out */
function parseFrames(body: string): Frame[] {
  return body
    .split('\n\n')
    .filter((block) => block && !block.startsWith(':'))
    .map((block) => {
      const lines = block.split('\n');
      assert.equal(lines.length, 2, `a frame has one event line and one data line: ${JSON.stringify(block)}`);
      assert.match(lines[0], /^event: [a-z-]+$/);
      assert.match(lines[1], /^data: /);
      return { event: lines[0].slice('event: '.length), data: JSON.parse(lines[1].slice('data: '.length)) };
    });
}

interface Served {
  url: string;
  /** Resolves with the server side of the first request */
  server: Promise<{ sse: SseStream; res: ServerResponse; req: IncomingMessage }>;
  close: () => Promise<void>;
}

/** A real HTTP server whose single route opens an SSE stream and hands it to the test */
async function serve(options?: SseOptions): Promise<Served> {
  let resolveServer: (value: { sse: SseStream; res: ServerResponse; req: IncomingMessage }) => void = () => undefined;
  const serverSide = new Promise<{ sse: SseStream; res: ServerResponse; req: IncomingMessage }>((resolve) => {
    resolveServer = resolve;
  });
  const server = createServer((req, res) => resolveServer({ sse: openSse(res, options), res, req }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    server: serverSide,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    }
  };
}

/** Counts the chunks written to a response */
function countWrites(res: ServerResponse): { readonly count: number } {
  const counter = { count: 0 };
  const write = res.write.bind(res) as (chunk: string) => boolean;
  res.write = ((chunk: string) => {
    counter.count++;
    return write(chunk);
  }) as ServerResponse['write'];
  return counter;
}

describe('openSse', () => {
  it('headers only on start, with exact values', async () => {
    const served = await serve();
    try {
      const response = fetch(served.url);
      const { sse, res } = await served.server;
      // Nothing is written before the first event
      await delay(20);
      assert.equal(res.headersSent, false);

      sse.send(start());
      assert.equal(res.headersSent, true);
      assert.deepEqual(res.getHeaderNames().sort(), [
        'cache-control',
        'content-type',
        'x-accel-buffering',
        'x-content-type-options'
      ]);
      sse.close();

      const client = await response;
      assert.equal(client.status, 200);
      assert.equal(client.headers.get('content-type'), 'text/event-stream; charset=utf-8');
      assert.equal(client.headers.get('cache-control'), 'no-store, no-transform');
      assert.equal(client.headers.get('x-accel-buffering'), 'no');
      assert.equal(client.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(
        parseFrames(await client.text()).map((frame) => frame.event),
        ['start']
      );
    } finally {
      await served.close();
    }
  });

  it('frames are single-line', async () => {
    const served = await serve();
    try {
      const response = fetch(served.url);
      const { sse } = await served.server;
      const tricky = 'line one\nline two\r\n\nevent: fake\u2028after LS\u2029after PS';
      sse.send(start());
      sse.send(event({ type: 'text-delta', step: 0, delta: tricky }));
      sse.close();

      const body = await (await response).text();
      assert.ok(!body.includes('\u2028') && !body.includes('\u2029'), 'the separators are escaped');
      const frames = parseFrames(body);
      assert.deepEqual(
        frames.map((frame) => frame.event),
        ['start', 'text-delta']
      );
      assert.equal(frames[1].data.delta, tricky);
      assert.ok(body.endsWith('\n\n'));
    } finally {
      await served.close();
    }
  });

  it('data name never becomes the SSE event', async () => {
    const served = await serve();
    try {
      const response = fetch(served.url);
      const { sse } = await served.server;
      sse.send(start());
      sse.send(
        event({
          type: 'data',
          step: 0,
          toolCallId: 'c1',
          toolName: 'lookup_order',
          name: 'finish\nevent: finish',
          data: { stage: 'loading' }
        })
      );
      sse.close();

      const frames = parseFrames(await (await response).text());
      assert.deepEqual(
        frames.map((frame) => frame.event),
        ['start', 'data']
      );
      assert.equal(frames[1].data.name, 'finish\nevent: finish');
    } finally {
      await served.close();
    }
  });

  it('unserialisable data dropped, stream continues', async () => {
    const served = await serve();
    try {
      const response = fetch(served.url);
      const { sse } = await served.server;
      const cycle: Record<string, unknown> = {};
      cycle.self = cycle;
      const tool = { step: 0, toolCallId: 'c1', toolName: 'lookup_order', name: 'progress' };
      sse.send(start());
      sse.send(event({ type: 'data', ...tool, data: { big: BigInt(1) } }));
      sse.send(event({ type: 'data', ...tool, data: cycle }));
      sse.send(event({ type: 'data', ...tool, data: { stage: 'done' } }));
      sse.close();

      const frames = parseFrames(await (await response).text());
      assert.deepEqual(
        frames.map((frame) => frame.event),
        ['start', 'data']
      );
      assert.deepEqual(frames[1].data.data, { stage: 'done' });
    } finally {
      await served.close();
    }
  });

  it('unknown event types skipped', async () => {
    const served = await serve();
    try {
      const response = fetch(served.url);
      const { sse } = await served.server;
      sse.send(start());
      sse.send({ seq: 99, runId: 'run-1', type: 'step-reset', step: 0 } as unknown as Chat.ChatStreamEvent);
      sse.send(event({ type: 'abort', reason: 'cancelled' }));
      sse.close();

      const frames = parseFrames(await (await response).text());
      assert.deepEqual(
        frames.map((frame) => frame.event),
        ['start', 'abort']
      );
    } finally {
      await served.close();
    }
  });

  it('heartbeat every interval and stops on close', async () => {
    const served = await serve({ heartbeatMs: 20 });
    try {
      const response = fetch(served.url);
      const { sse, res } = await served.server;
      const writes = countWrites(res);
      sse.send(start());
      await delay(110);
      sse.close();
      const writesAtClose = writes.count;
      await delay(60);
      assert.equal(writes.count, writesAtClose, 'no ping after close');

      const body = await (await response).text();
      const pings = body.split('\n\n').filter((block) => block === ': ping').length;
      assert.ok(pings >= 2, `expected at least 2 pings, got ${pings}`);
    } finally {
      await served.close();
    }
  });

  it('client close aborts the signal', async () => {
    const served = await serve();
    try {
      const controller = new AbortController();
      const response = fetch(served.url, { signal: controller.signal });
      const { sse } = await served.server;
      sse.send(start());
      await response;
      assert.equal(sse.signal.aborted, false);

      controller.abort();
      await once(sse.signal, 'abort');
      assert.equal(sse.signal.aborted, true);
    } finally {
      await served.close();
    }
  });

  it('onDisconnect finish keeps the signal alive until maxGenerationMs', async () => {
    // Checked before the response is touched
    assert.throws(() => openSse({} as ServerResponse, { onDisconnect: 'finish' }), { message: /maxGenerationMs/ });

    const served = await serve({ onDisconnect: 'finish', maxGenerationMs: 300 });
    try {
      const controller = new AbortController();
      const response = fetch(served.url, { signal: controller.signal });
      const { sse, res } = await served.server;
      sse.send(start());
      await response;
      controller.abort();
      await once(res, 'close');

      // The client is gone, but the generation goes on until the deadline
      await delay(50);
      assert.equal(sse.signal.aborted, false);
      sse.send(event({ type: 'text-delta', step: 0, delta: 'nobody reads this' }));

      await once(sse.signal, 'abort');
      assert.equal((sse.signal.reason as Error).name, 'TimeoutError');
    } finally {
      await served.close();
    }
  });

  it('slow reader past maxBufferedBytes aborts and ends', async () => {
    const served = await serve({ maxBufferedBytes: 16 * 1024 });
    try {
      // A client that never reads the body
      const clientRequest = request(served.url, (incoming) => incoming.pause());
      clientRequest.on('error', () => undefined);
      clientRequest.end();
      const { sse, res } = await served.server;

      sse.send(start());
      const delta = 'x'.repeat(64 * 1024);
      for (let i = 0; i < 1000 && !sse.signal.aborted; i++) {
        sse.send(event({ type: 'text-delta', step: 0, delta }));
        // Give the socket a chance to fill the kernel buffer
        await delay(1);
      }

      assert.equal(sse.signal.aborted, true);
      assert.equal(res.destroyed, true);
      clientRequest.destroy();
    } finally {
      await served.close();
    }
  });

  it('no write after end', async () => {
    const served = await serve({ heartbeatMs: 10 });
    try {
      const response = fetch(served.url);
      const { sse, res } = await served.server;
      const errors: Error[] = [];
      res.on('error', (error) => errors.push(error));
      sse.send(start());
      sse.close();
      const writes = countWrites(res);

      sse.send(event({ type: 'text-delta', step: 0, delta: 'late' }));
      sse.close();
      await delay(40);

      assert.equal(writes.count, 0);
      assert.deepEqual(errors, []);
      assert.deepEqual(
        parseFrames(await (await response).text()).map((frame) => frame.event),
        ['start']
      );
    } finally {
      await served.close();
    }
  });

  it('fail delivers the written frames, then breaks the connection', async () => {
    const served = await serve();
    try {
      const response = await (async () => {
        const pending = fetch(served.url);
        const { sse } = await served.server;
        sse.send(start());
        sse.send(
          event({ type: 'finish', reason: 'stop', finishReason: 'stop', text: 'Hi', textReplaced: false, usage })
        );
        sse.fail();
        sse.close();
        return pending;
      })();

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let body = '';
      await assert.rejects(async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          body += decoder.decode(value, { stream: true });
        }
      });
      assert.deepEqual(
        parseFrames(body).map((frame) => frame.event),
        ['start', 'finish']
      );
    } finally {
      await served.close();
    }
  });

  it('usage stripped', async () => {
    const served = await serve();
    try {
      const response = fetch(served.url);
      const { sse } = await served.server;
      sse.send(start());
      sse.send(
        event({
          type: 'step-finish',
          step: 0,
          reason: 'stop',
          finishReason: 'stop',
          hadToolCalls: false,
          streamed: true,
          usage
        })
      );
      sse.send(event({ type: 'finish', reason: 'stop', finishReason: 'stop', text: 'Hi', textReplaced: false, usage }));
      sse.close();

      const frames = parseFrames(await (await response).text());
      assert.deepEqual(
        frames.map((frame) => frame.event),
        ['start', 'step-finish', 'finish']
      );
      for (const frame of frames) assert.equal('usage' in frame.data, false);
      assert.equal(frames[2].data.text, 'Hi');
      assert.equal(frames[1].data.finishReason, 'stop');
      assert.equal(frames[2].data.reason, 'stop');
    } finally {
      await served.close();
    }
  });

  it('the reason of an abort and the wait of a rate limit pass through', async () => {
    for (const terminal of [
      event({ type: 'abort', reason: 'timeout' }),
      event({
        type: 'error',
        code: 'rate_limited',
        message: 'Too many requests. Try again shortly.',
        retryable: true,
        retryAfterMs: 20_000
      })
    ]) {
      const served = await serve();
      try {
        const response = fetch(served.url);
        const { sse } = await served.server;
        sse.send(start());
        sse.send(terminal);
        sse.close();

        const frames = parseFrames(await (await response).text());
        assert.deepEqual(frames[1].data, terminal);
      } finally {
        await served.close();
      }
    }
  });
});
