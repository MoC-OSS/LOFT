import * as fs from 'node:fs';
import * as path from 'node:path';

import Anthropic, { APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import { isRetryableError, Logger, Strategy } from '@moc-global/loft-definitions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnthropicCallStrategy } from '../../AnthropicCallStrategy';
import { streamMessage } from '../../streaming/streamMessage';

// Seeded scenarios: every iteration has its own seed, printed when it fails. SCENARIO_SEED moves the whole run, and
// SCENARIO_ONLY_SEED reruns one iteration
const BASE_SEED = Number(process.env.SCENARIO_SEED ?? 20261022);
const ONLY_SEED = process.env.SCENARIO_ONLY_SEED === undefined ? undefined : Number(process.env.SCENARIO_ONLY_SEED);
const ITERATIONS = 200;

interface Random {
  next(): number;
  int(max: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
}

// mulberry32
function randomOf(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (max: number) => Math.floor(next() * max);
  return { next, int, chance: (probability) => next() < probability, pick: (items) => items[int(items.length)]! };
}

const hashOf = (label: string) =>
  [...label].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), 2166136261);

async function forEachSeed(
  label: string,
  run: (random: Random, seed: number) => Promise<void> | void,
  iterations = ITERATIONS
): Promise<void> {
  const seeds =
    ONLY_SEED !== undefined
      ? [ONLY_SEED]
      : Array.from({ length: iterations }, (_, i) => (BASE_SEED + hashOf(label) + i * 7919) >>> 0);
  for (const seed of seeds) {
    try {
      await run(randomOf(seed), seed);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${label}: seed ${seed} failed (rerun with SCENARIO_ONLY_SEED=${seed}): ${reason}`, {
        cause: error
      });
    }
  }
}

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/stream');
const COMPLETED_FIXTURES = [
  'text',
  'tool-use',
  'parallel-tools',
  'thinking',
  'max-tokens',
  'refusal',
  'stop-sequence',
  'redacted-citations'
];

type RawEvent = Anthropic.RawMessageStreamEvent | { type: 'ping' } | { type: 'error'; error: object };

interface Fixture {
  events: RawEvent[];
  message: Anthropic.Message;
}

const readFixture = <T = Fixture>(name: string): T =>
  JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8')) as T;

const encoder = new TextEncoder();
const sseText = (events: RawEvent[], lineEnd = '\n') =>
  events.map((event) => `event: ${event.type}${lineEnd}data: ${JSON.stringify(event)}${lineEnd}${lineEnd}`).join('');
const toSse = (events: RawEvent[], lineEnd = '\n'): Uint8Array => encoder.encode(sseText(events, lineEnd));
// One network chunk per event
const eventChunks = (events: RawEvent[]): Uint8Array[] => events.map((event) => toSse([event]));

// Cut positions that tend to break parsers: inside a multi-byte code point, around line ends, after a quote, a
// backslash, a colon or a brace
function interestingCuts(bytes: Uint8Array): number[] {
  const cuts: number[] = [];
  for (let i = 1; i < bytes.length; i++) {
    const byte = bytes[i]!;
    const before = bytes[i - 1]!;
    if (
      (byte & 0xc0) === 0x80 ||
      byte === 0x0a ||
      byte === 0x0d ||
      before === 0x0a ||
      before === 0x22 ||
      before === 0x5c ||
      before === 0x3a ||
      before === 0x7b
    ) {
      cuts.push(i);
    }
  }
  return cuts;
}

// Random network chunks: fixed sizes, random cuts, or cuts biased to the positions above, with an empty read now and
// then
function randomSplit(bytes: Uint8Array, random: Random): Uint8Array[] {
  if (bytes.length < 2) return [bytes];
  const cuts = new Set<number>();
  const mode = random.int(4);
  if (mode === 0) {
    const size = 1 + random.int(16);
    for (let i = size; i < bytes.length; i += size) cuts.add(i);
  } else {
    const interesting = interestingCuts(bytes);
    const count = 1 + random.int(Math.min(48, bytes.length - 1));
    for (let n = 0; n < count; n++) {
      cuts.add(mode >= 2 && interesting.length ? random.pick(interesting) : 1 + random.int(bytes.length - 1));
    }
  }
  const chunks: Uint8Array[] = [];
  let start = 0;
  for (const cut of [...cuts].sort((a, b) => a - b)) {
    chunks.push(bytes.slice(start, cut));
    if (random.chance(0.03)) chunks.push(new Uint8Array(0));
    start = cut;
  }
  chunks.push(bytes.slice(start));
  return chunks;
}

// What undici's fetch errors a body with when the server's socket closes mid-response
const socketClosed = () =>
  new TypeError('terminated', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) });

// A fetch that answers with the byte chunks as an event stream, one chunk per read. An aborted request signal errors
// the body, as a real fetch does. `beforeChunk` runs before the chunk at that index is sent, and the socket closes
// instead of sending the chunk at `failAt`
function fakeFetch(chunks: Uint8Array[], beforeChunk?: (index: number) => void, failAt?: number) {
  const fetch = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal;
    let next = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
      },
      pull(controller) {
        beforeChunk?.(next);
        if (signal?.aborted) return;
        if (next === failAt) return controller.error(socketClosed());
        const chunk = chunks[next++];
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      }
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { fetch };
}

const BODY: Anthropic.MessageCreateParamsNonStreaming = {
  model: 'claude-haiku-5-5',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hi' }]
};

interface RunOptions {
  signal?: AbortSignal;
  sink?: (event: Strategy.LLM.LlmStreamEvent) => void;
  beforeChunk?: (index: number) => void;
  failAt?: number;
}

async function run(chunks: Uint8Array[], options: RunOptions = {}) {
  const events: Strategy.LLM.LlmStreamEvent[] = [];
  const client = new Anthropic({
    apiKey: 'test-key',
    fetch: fakeFetch(chunks, options.beforeChunk, options.failAt).fetch,
    maxRetries: 0
  });
  const onEvent: Strategy.LLM.LlmStreamSink = (event) => {
    events.push(event);
    options.sink?.(event);
  };
  const result = await streamMessage(client, BODY, { signal: options.signal, onEvent }).then(
    (message) => ({ message, error: undefined }),
    (error: unknown) => ({ message: undefined, error })
  );
  return { ...result, events };
}

// The class and message of an error, for failure messages; the fixtures hold no secrets
const errorText = (error: unknown) =>
  error instanceof Error ? `${error.constructor.name}: ${error.message}` : `${typeof error}: ${String(error)}`;

const deltasOf = (events: Strategy.LLM.LlmStreamEvent[], type: 'text-delta' | 'reasoning-delta' = 'text-delta') =>
  events.map((event) => (event.type === type ? event.delta : '')).join('');
const blockText = (message: Anthropic.Message) =>
  message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
const blockThinking = (message: Anthropic.Message) =>
  message.content.map((block) => (block.type === 'thinking' ? block.thinking : '')).join('');

// Random text with the characters that tend to break stream parsers or byte splits
const TEXT_PIECES = [
  'a',
  'Z',
  ' ',
  '\n',
  '\r',
  '\t',
  '"',
  '\\',
  '/',
  '{',
  '}',
  ':',
  'data: ',
  'event: ping',
  '\n\n',
  'Привіт',
  '日本語',
  '👋🏽',
  '👩‍💻',
  'é',
  'é',
  ' ',
  ' ',
  '\u0000',
  '𝕏',
  'ß'
];
const randomText = (random: Random, maxPieces: number) =>
  Array.from({ length: 1 + random.int(maxPieces) }, () => random.pick(TEXT_PIECES)).join('');

// Splits a string into fragments at code point boundaries
function fragments(text: string, random: Random): string[] {
  const points = Array.from(text);
  const parts: string[] = [];
  let start = 0;
  while (start < points.length) {
    const size = 1 + random.int(6);
    parts.push(points.slice(start, start + size).join(''));
    start += size;
  }
  return parts.length ? parts : [''];
}

const USAGE = {
  input_tokens: 12,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 1,
  service_tier: 'standard' as const
};
// Shaped like the fixtures' message_start, which leaves out usage fields the SDK types list
const messageStart = (): RawEvent =>
  ({
    type: 'message_start',
    message: {
      id: 'msg_scenario',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: USAGE
    }
  }) as unknown as RawEvent;
const messageEnd = (stopReason: string): RawEvent[] => [
  {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 42 }
  } as RawEvent,
  { type: 'message_stop' }
];

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_BASE_URL', '');
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe(`random network splits of each fixture (seed ${BASE_SEED})`, () => {
  describe.each(COMPLETED_FIXTURES)('the %s stream', (name) => {
    it('resolves with the non-streamed message and the same events, and the text deltas equal the text blocks', async () => {
      const { events: raw, message } = readFixture(name);
      const bytes = toSse(raw);
      const baseline = await run(eventChunks(raw));
      expect(baseline.message).toEqual(message);
      expect(deltasOf(baseline.events)).toBe(blockText(message));
      expect(deltasOf(baseline.events, 'reasoning-delta')).toBe(blockThinking(message));

      await forEachSeed(`anthropic split ${name}`, async (random) => {
        const { message: streamed, events, error } = await run(randomSplit(bytes, random));

        expect(error).toBeUndefined();
        expect(streamed).toEqual(message);
        expect(events).toEqual(baseline.events);
      });
    });
  });

  it('CRLF line ends give the same result', async () => {
    for (const name of COMPLETED_FIXTURES) {
      const { events: raw, message } = readFixture(name);
      const baseline = await run(eventChunks(raw));
      await forEachSeed(
        `anthropic crlf ${name}`,
        async (random) => {
          const { message: streamed, events } = await run(randomSplit(toSse(raw, '\r\n'), random));

          expect(streamed).toEqual(message);
          expect(events).toEqual(baseline.events);
        },
        20
      );
    }
  });

  it('a mid-stream overloaded error rejects with the same retryable SDK error however the bytes are split', async () => {
    const fixture = readFixture<{ events: RawEvent[]; error: object; textBeforeError: string }>('mid-stream-error');
    const bytes = toSse(fixture.events);

    await forEachSeed('anthropic split mid-stream-error', async (random) => {
      const { error, events } = await run(randomSplit(bytes, random));

      expect(error).toBeInstanceOf(APIError);
      expect(error).toMatchObject({ status: undefined, type: 'overloaded_error', error: fixture.error });
      expect(isRetryableError(error)).toBe(true);
      expect(deltasOf(events)).toBe(fixture.textBeforeError);
    });
  });
});

describe(`random text and thinking in random deltas (seed ${BASE_SEED})`, () => {
  it('the deltas and the blocks equal the text, however it is split', async () => {
    await forEachSeed('anthropic random text', async (random) => {
      const thinking = random.chance(0.5) ? randomText(random, 20) : '';
      const text = randomText(random, 40);
      const raw: RawEvent[] = [
        messageStart(),
        ...(thinking
          ? ([
              {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'thinking', thinking: '', signature: '' }
              },
              ...fragments(thinking, random).map((piece) => ({
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'thinking_delta', thinking: piece }
              })),
              { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SECRETSIG==' } },
              { type: 'content_block_stop', index: 0 }
            ] as RawEvent[])
          : []),
        { type: 'content_block_start', index: thinking ? 1 : 0, content_block: { type: 'text', text: '' } } as RawEvent,
        ...fragments(text, random).map(
          (piece) =>
            ({
              type: 'content_block_delta',
              index: thinking ? 1 : 0,
              delta: { type: 'text_delta', text: piece }
            }) as RawEvent
        ),
        { type: 'content_block_stop', index: thinking ? 1 : 0 } as RawEvent,
        ...messageEnd('end_turn')
      ];

      const { message, events, error } = await run(randomSplit(toSse(raw), random));

      expect(error).toBeUndefined();
      expect(blockText(message!)).toBe(text);
      expect(deltasOf(events)).toBe(text);
      expect(blockThinking(message!)).toBe(thinking);
      expect(deltasOf(events, 'reasoning-delta')).toBe(thinking);
      expect(JSON.stringify(events)).not.toMatch(/SECRETSIG/);
    });
  });
});

interface ToolPlan {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// Random tools whose names, ids and inputs carry markers that must never reach an event
const randomTools = (random: Random, count: number): ToolPlan[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `toolu_SECRETID${i}x${random.int(1000)}`,
    name: `tool_SECRETNAME_${i}`,
    input: { query: `SECRETARG ${randomText(random, 6)}`, n: random.int(100), nested: { ok: i % 2 === 0 } }
  }));

// A random merge of sequences that keeps each sequence's order
function interleave<T>(sequences: T[][], random: Random): T[] {
  const queues = sequences.map((sequence) => [...sequence]);
  const merged: T[] = [];
  for (;;) {
    const open = queues.filter((queue) => queue.length > 0);
    if (!open.length) return merged;
    merged.push(random.pick(open).shift()!);
  }
}

// The events of tool blocks: each block's start, its input JSON in random pieces (an empty first piece now and then),
// and its stop
function toolBlockEvents(tools: ToolPlan[], firstIndex: number, random: Random): RawEvent[][] {
  return tools.map((tool, i) => {
    const index = firstIndex + i;
    const pieces = fragments(JSON.stringify(tool.input), random);
    return [
      {
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: tool.id, name: tool.name, input: {} }
      },
      ...(random.chance(0.5)
        ? [{ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: '' } }]
        : []),
      ...pieces.map((piece) => ({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: piece }
      })),
      { type: 'content_block_stop', index }
    ] as RawEvent[];
  });
}

describe(`parallel tool use (seed ${BASE_SEED})`, () => {
  it('random tool inputs in random pieces arrive whole, in order, and never leak', async () => {
    await forEachSeed('anthropic parallel tools', async (random) => {
      const tools = randomTools(random, 1 + random.int(5));
      const leading = random.chance(0.4) ? randomText(random, 8) : '';
      const textBlock: RawEvent[] = leading
        ? [
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: null } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: leading } },
            { type: 'content_block_stop', index: 0 }
          ]
        : [];
      const blocks = toolBlockEvents(tools, leading ? 1 : 0, random);
      const raw = [messageStart(), ...textBlock, ...blocks.flat(), ...messageEnd('tool_use')];
      const nonEmptyToolEvents = blocks
        .flat()
        .filter(
          (event) =>
            event.type === 'content_block_start' ||
            (event.type === 'content_block_delta' &&
              event.delta.type === 'input_json_delta' &&
              event.delta.partial_json)
        ).length;

      const { message, events, error } = await run(randomSplit(toSse(raw), random));

      expect(error).toBeUndefined();
      expect(message?.content.filter((block) => block.type === 'tool_use')).toEqual(
        tools.map(({ id, name, input }) => ({ type: 'tool_use', id, name, input }))
      );
      expect(deltasOf(events)).toBe(leading);
      expect(events.filter((event) => event.type === 'activity')).toHaveLength(nonEmptyToolEvents);
      expect(JSON.stringify(events)).not.toMatch(/SECRET/);
    });
  });

  it('input pieces of started tool blocks, interleaved at random, still build each input', async () => {
    await forEachSeed('anthropic interleaved tool deltas', async (random) => {
      const tools = randomTools(random, 2 + random.int(4));
      const blocks = toolBlockEvents(tools, 0, random);
      // Every block starts in order; the input pieces and stops of the open blocks then interleave
      const raw = [
        messageStart(),
        ...blocks.map((block) => block[0]!),
        ...interleave(
          blocks.map((block) => block.slice(1)),
          random
        ),
        ...messageEnd('tool_use')
      ];

      const { message, events, error } = await run(randomSplit(toSse(raw), random));

      expect(error, errorText(error)).toBeUndefined();
      expect(message?.content).toEqual(tools.map(({ id, name, input }) => ({ type: 'tool_use', id, name, input })));
      expect(JSON.stringify(events)).not.toMatch(/SECRET/);
    });
  });
});

describe(`pings and empty deltas (seed ${BASE_SEED})`, () => {
  describe.each(COMPLETED_FIXTURES)('in the %s stream', (name) => {
    it('change neither the message nor the events', async () => {
      const { events: raw, message } = readFixture(name);
      const baseline = await run(eventChunks(raw));

      await forEachSeed(`anthropic empty events ${name}`, async (random) => {
        const mixed: RawEvent[] = [];
        // The block open at each point, to give an empty delta of the matching kind
        let open: { index: number; type: string } | undefined;
        for (const event of raw) {
          mixed.push(event);
          if (event.type === 'content_block_start') open = { index: event.index, type: event.content_block.type };
          if (event.type === 'content_block_stop') open = undefined;
          if (event.type === 'message_stop') continue;
          for (let n = random.int(3); n > 0; n--) {
            if (random.chance(0.5) || !open) mixed.push({ type: 'ping' });
            else if (open.type === 'text') {
              mixed.push({ type: 'content_block_delta', index: open.index, delta: { type: 'text_delta', text: '' } });
            } else if (open.type === 'thinking') {
              mixed.push({
                type: 'content_block_delta',
                index: open.index,
                delta: { type: 'thinking_delta', thinking: '' }
              });
            } else if (open.type === 'tool_use') {
              mixed.push({
                type: 'content_block_delta',
                index: open.index,
                delta: { type: 'input_json_delta', partial_json: '' }
              });
            }
          }
        }

        const { message: streamed, events, error } = await run(randomSplit(toSse(mixed), random));

        expect(error, errorText(error)).toBeUndefined();
        expect(streamed).toEqual(message);
        expect(events).toEqual(baseline.events);
      });
    });
  });
});

describe(`an abort at a random point (seed ${BASE_SEED})`, () => {
  const expectAbort = (error: unknown) => {
    expect(error, errorText(error)).toBeInstanceOf(APIUserAbortError);
    expect(isRetryableError(error)).toBe(false);
  };

  it.each(COMPLETED_FIXTURES)('before a random network chunk of %s rejects with the SDK abort error', async (name) => {
    const { events: raw } = readFixture(name);
    const bytes = toSse(raw);
    const baseline = await run(eventChunks(raw));

    await forEachSeed(`anthropic abort chunk ${name}`, async (random) => {
      const chunks = randomSplit(bytes, random);
      const abortAt = random.int(chunks.length + 1);
      const controller = new AbortController();
      const { error, message, events } = await run(chunks, {
        signal: controller.signal,
        beforeChunk: (index) => index === abortAt && controller.abort()
      });

      expect(message).toBeUndefined();
      expectAbort(error);
      expect(events).toEqual(baseline.events.slice(0, events.length));
    });
  });

  it.each(COMPLETED_FIXTURES)('on a random event of %s rejects with the SDK abort error', async (name) => {
    const { events: raw } = readFixture(name);
    const baseline = await run(eventChunks(raw));

    await forEachSeed(`anthropic abort event ${name}`, async (random) => {
      const abortOn = random.int(baseline.events.length);
      const controller = new AbortController();
      let seen = 0;
      const { error, events } = await run(randomSplit(toSse(raw), random), {
        signal: controller.signal,
        sink: () => seen++ === abortOn && controller.abort()
      });

      expectAbort(error);
      expect(events).toEqual(baseline.events.slice(0, events.length));
      expect(events.length).toBeGreaterThan(abortOn);
    });
  });
});

describe(`a connection that closes early (seed ${BASE_SEED})`, () => {
  it.each(COMPLETED_FIXTURES)(
    'the %s stream dropped by the socket at a random chunk rejects with a retryable error',
    async (name) => {
      const { events: raw } = readFixture(name);
      const bytes = toSse(raw);

      await forEachSeed(`anthropic socket drop ${name}`, async (random) => {
        const chunks = randomSplit(bytes, random);
        const { message, error } = await run(chunks, { failAt: random.int(chunks.length) });

        expect(message).toBeUndefined();
        expect(isRetryableError(error), errorText(error)).toBe(true);
      });
    }
  );

  it.each(COMPLETED_FIXTURES)(
    'the %s stream closed right after message_stop resolves with the message',
    async (name) => {
      const { events: raw, message } = readFixture(name);

      await forEachSeed(`anthropic close after stop ${name}`, async (random) => {
        const { message: streamed } = await run(randomSplit(toSse(raw), random));

        expect(streamed).toEqual(message);
      });
    }
  );

  // A stream closed cleanly before message_stop rejects with a retryable connection error, as the OpenAI and Gemini
  // streams do
  it.each(COMPLETED_FIXTURES)(
    'the %s stream closed after a random event before message_stop rejects with a retryable error',
    async (name) => {
      const { events: raw } = readFixture(name);

      await forEachSeed(`anthropic close at event ${name}`, async (random) => {
        const kept = raw.slice(0, random.int(raw.length));
        const { message, error } = await run(randomSplit(toSse(kept), random));

        expect(message).toBeUndefined();
        expect(isRetryableError(error), `closed after ${kept.length} events: ${errorText(error)}`).toBe(true);
      });
    }
  );

  // The same, for a stream closed inside an event
  it.each(COMPLETED_FIXTURES)('the %s stream closed inside an event rejects with a retryable error', async (name) => {
    const { events: raw } = readFixture(name);
    const bytes = toSse(raw);
    const lastEvent = toSse(raw.slice(-1)).length;

    await forEachSeed(`anthropic close inside event ${name}`, async (random) => {
      const cut = random.int(bytes.length - lastEvent);
      const { message, error } = await run(randomSplit(bytes.slice(0, cut), random));

      expect(message).toBeUndefined();
      expect(isRetryableError(error), `closed at byte ${cut}: ${errorText(error)}`).toBe(true);
    });
  });
});

describe(`the call strategy over random splits (seed ${BASE_SEED})`, () => {
  it.each(['tool-use', 'thinking', 'redacted-citations'])(
    'generate on %s resolves with the non-streamed message',
    async (name) => {
      const { events: raw, message } = readFixture(name);
      const bytes = toSse(raw);

      await forEachSeed(`anthropic strategy ${name}`, async (random) => {
        const strategy = new AnthropicCallStrategy(
          { apiKey: 'test-key', fetch: fakeFetch(randomSplit(bytes, random)).fetch, maxRetries: 0 },
          {} as Strategy.LLM.LlmTokenRateLimiter,
          {} as Strategy.LLM.LlmTokenizer
        );
        const events: Strategy.LLM.LlmStreamEvent[] = [];

        const response = await strategy.generate<Anthropic.MessageCreateParams, Anthropic.Message>(BODY, {
          onEvent: (event) => void events.push(event)
        });

        expect(response).toEqual(message);
        expect(deltasOf(events)).toBe(blockText(message));
      });
    }
  );
});
