import type { ServerResponse } from 'node:http';

import { Chat } from '@moc-global/loft-definitions';

export interface SseOptions {
  /** Milliseconds between `: ping` comments, which keep proxies from closing a quiet connection. Default 15000 */
  heartbeatMs?: number;
  /**
   * When more bytes than this wait to be sent to a slow client, the response ends and the generation is aborted. The
   * largest single frame does not count, so one frame bigger than the limit still goes out. Default 1 MiB
   */
  maxBufferedBytes?: number;
  /**
   * What a client disconnect does. `'abort'` (default) aborts the generation, and nothing is saved. `'finish'` lets
   * the generation run to the end, so the reply is still saved; it requires `maxGenerationMs`.
   */
  onDisconnect?: 'abort' | 'finish';
  /** Aborts the generation after this many milliseconds. Required with `onDisconnect: 'finish'` */
  maxGenerationMs?: number;
}

export interface SseStream {
  /** Writes one event as an SSE frame. The headers go out with the first event, which is `start`. */
  send(event: Chat.ChatStreamEvent): void;
  /** Ends the response. Safe to call more than once; nothing is written after it. */
  close(): void;
  /**
   * Ends the response as broken: the frames already written still reach the client, then the connection is cut
   * without the end-of-stream marker, so the client sees an error instead of a clean end.
   */
  fail(): void;
  /** Pass it to `generate()`: it aborts on a client disconnect (with `'abort'`), a slow client or the deadline. */
  readonly signal: AbortSignal;
}

const HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store, no-transform',
  // Turns off response buffering in nginx, which would hold the events back
  'X-Accel-Buffering': 'no',
  'X-Content-Type-Options': 'nosniff'
};

// The only SSE event names. New event types that this list does not know yet are skipped, not forwarded.
const EVENT_TYPES: ReadonlySet<string> = new Set([
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
] satisfies Chat.ChatStreamEvent['type'][]);

/** `event: <type>` and one `data:` line, or undefined when the event is unknown or cannot be serialised. */
function toFrame(event: Chat.ChatStreamEvent): string | undefined {
  if (!EVENT_TYPES.has(event.type)) return undefined;

  // Token usage stays on the server
  const payload: Record<string, unknown> = { ...event };
  delete payload.usage;

  let json: string;
  try {
    json = JSON.stringify(payload);
  } catch {
    // A BigInt or a cycle in a tool's data: drop this frame, keep the stream
    return undefined;
  }
  // JSON.stringify escapes line breaks but not these two separators, which some parsers treat as line ends
  json = json.replaceAll('\u2028', String.raw`\u2028`).replaceAll('\u2029', String.raw`\u2029`);
  return `event: ${event.type}\ndata: ${json}\n\n`;
}

/** Throws when the options cannot work, so a server can check them once at startup. */
export function validateSseOptions(options: SseOptions = {}): void {
  if (options.onDisconnect === 'finish' && options.maxGenerationMs === undefined) {
    throw new Error("onDisconnect: 'finish' requires maxGenerationMs, so a generation nobody reads still ends");
  }
}

/**
 * Turns an Express (or plain Node) response into a Server-Sent Events stream for one `generate()` call. Nothing is
 * written until the first event, so an error before `start` can still be answered as JSON with a status code.
 */
export function openSse(res: ServerResponse, options: SseOptions = {}): SseStream {
  validateSseOptions(options);
  const { heartbeatMs = 15_000, maxBufferedBytes = 1024 * 1024, onDisconnect = 'abort', maxGenerationMs } = options;

  const controller = new AbortController();
  const signal =
    maxGenerationMs === undefined
      ? controller.signal
      : AbortSignal.any([controller.signal, AbortSignal.timeout(maxGenerationMs)]);

  let ended = false;
  let heartbeat: NodeJS.Timeout | undefined;

  const stop = () => {
    ended = true;
    clearInterval(heartbeat);
  };

  // The largest frame written so far. It does not count toward the limit, so one frame larger than the limit (a long
  // reply in one delta, or the finish frame, which carries the whole reply) still reaches a client that reads at once.
  let largestFrameBytes = 0;

  const write = (chunk: string) => {
    if (ended) return;
    // Checked before the write: a client that stopped reading is caught on the first write after the limit
    if (res.writableLength - largestFrameBytes > maxBufferedBytes) {
      // The client reads too slowly. End the response at once (ending it normally would wait for the buffer to
      // drain) and stop the generation.
      stop();
      res.destroy();
      controller.abort(new Error('The client reads the stream too slowly'));
      return;
    }
    largestFrameBytes = Math.max(largestFrameBytes, Buffer.byteLength(chunk));
    res.write(chunk);
  };

  res.on('close', () => {
    if (ended) return;
    // The client went away before the stream ended
    stop();
    if (onDisconnect === 'abort') controller.abort(new Error('The client disconnected'));
  });

  return {
    signal,
    send(event) {
      if (ended) return;
      const frame = toFrame(event);
      if (frame === undefined) return;
      if (!res.headersSent) {
        for (const [name, value] of Object.entries(HEADERS)) res.setHeader(name, value);
        res.writeHead(200);
        heartbeat = setInterval(() => write(': ping\n\n'), heartbeatMs);
        heartbeat.unref();
      }
      write(frame);
    },
    close() {
      if (ended) return;
      stop();
      if (!res.writableEnded && !res.destroyed) res.end();
    },
    fail() {
      if (ended) return;
      stop();
      if (res.writableEnded || res.destroyed) return;
      // Destroying at once could drop frames still in the buffer; the write callback runs once they are sent
      res.write(': failed\n\n', () => res.destroy());
    }
  };
}
