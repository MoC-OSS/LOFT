import * as fs from 'node:fs';
import * as path from 'node:path';

import { isRetryableError, Strategy } from '@moc-global/loft-definitions';
import OpenAI, { APIError, APIUserAbortError } from 'openai';
import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AzureOpenAiCallStrategy } from '../../AzureOpenAiCallStrategy';
import { OpenAiLoftStrategy } from '../../OpenAiLoftStrategy';
import { OpenAiRequest } from '../../OpenAiTypes';
import { accumulateChatCompletion } from '../../streaming/accumulateChatCompletion';
import { CreateChatCompletionStream, streamChatCompletion } from '../../streaming/streamChatCompletion';

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

// The index of the last item that passes the test, or -1 (the packages' TS target has no findLastIndex)
function lastIndexWhere<T>(items: readonly T[], test: (item: T) => unknown): number {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i]!)) return i;
  return -1;
}

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/stream');
const COMPLETED_FIXTURES = [
  'text',
  'tool-calls',
  'parallel-tools',
  'refusal',
  'n2',
  'usage-last',
  'utf8-split',
  'azure-prompt-filter',
  'content-filter-midstream'
];

const readSse = (name: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.sse`)));
const readProjection = <T = ChatCompletion>(name: string): T =>
  JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8')) as T;
const parseSse = (name: string): ChatCompletionChunk[] =>
  new TextDecoder()
    .decode(readSse(name))
    .split('\n\n')
    .map((event) => event.replace(/^data: /, ''))
    .filter((data) => data && data !== '[DONE]')
    .map((data) => JSON.parse(data) as ChatCompletionChunk);

const encoder = new TextEncoder();
const toSse = (chunks: ChatCompletionChunk[]): Uint8Array =>
  encoder.encode(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n');

// One network chunk per SSE event
function eventChunks(bytes: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let start = 0;
  for (let i = 1; i < bytes.length; i++) {
    if (bytes[i - 1] === 0x0a && bytes[i] === 0x0a) {
      chunks.push(bytes.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < bytes.length) chunks.push(bytes.slice(start));
  return chunks;
}

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

type ClientFactory = (fetch: ReturnType<typeof fakeFetch>['fetch']) => Promise<CreateChatCompletionStream>;

const openAiV7: ClientFactory = async (fetch) => {
  const client = new OpenAI({ apiKey: 'x', fetch, maxRetries: 0 });
  return (body, options) => client.chat.completions.create(body, options);
};

const openAiV4: ClientFactory = async (fetch) => {
  const OpenAiV4 = (await import('openai-v4')).default;
  const client = new OpenAiV4({ apiKey: 'x', fetch: fetch as never, maxRetries: 0 });
  // The v4 types differ from v7 only in fields these requests and chunks do not use
  return (body, options) =>
    client.chat.completions.create(body as never, options) as unknown as ReturnType<CreateChatCompletionStream>;
};

const REQUEST: OpenAiRequest = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Hi' }] };

interface RunOptions {
  client?: ClientFactory;
  signal?: AbortSignal;
  sink?: (event: Strategy.LLM.LlmStreamEvent) => void;
  beforeChunk?: (index: number) => void;
  failAt?: number;
}

async function run(chunks: Uint8Array[], options: RunOptions = {}) {
  const events: Strategy.LLM.LlmStreamEvent[] = [];
  const create = await (options.client ?? openAiV7)(fakeFetch(chunks, options.beforeChunk, options.failAt).fetch);
  const onEvent: Strategy.LLM.LlmStreamSink = (event) => {
    events.push(event);
    options.sink?.(event);
  };
  const result = await streamChatCompletion(create, REQUEST, {
    signal: options.signal,
    onEvent,
    includeUsage: true
  }).then(
    (completion) => ({ completion, error: undefined }),
    (error: unknown) => ({ completion: undefined, error })
  );
  return { ...result, events };
}

// Feeds parsed chunks straight to the streamer, without the SDK
async function runChunks(chunks: ChatCompletionChunk[]) {
  const events: Strategy.LLM.LlmStreamEvent[] = [];
  const create: CreateChatCompletionStream = async () =>
    (async function* () {
      yield* chunks;
    })();
  const completion = await streamChatCompletion(create, REQUEST, {
    onEvent: (event) => void events.push(event),
    includeUsage: true
  });
  return { completion, events };
}

// The class and message of an error, for failure messages; the fixtures hold no secrets
const errorText = (error: unknown) =>
  error instanceof Error ? `${error.constructor.name}: ${error.message}` : `${typeof error}: ${String(error)}`;

const textOf = (events: Strategy.LLM.LlmStreamEvent[]) =>
  events.map((event) => (event.type === 'text-delta' ? event.delta : '')).join('');
const choiceZeroText = (completion: ChatCompletion) =>
  (completion.choices[0]?.message.content ?? '') + (completion.choices[0]?.message.refusal ?? '');

const loftStrategy = new OpenAiLoftStrategy({ llmName: 'gpt' }, {} as Strategy.CallManager);
const unified = (completion: ChatCompletion) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
  const { originalResponse, ...rest } = loftStrategy.formatToUnifiedLLMResponse(
    [],
    's-1',
    completion,
    'gpt',
    'assistant'
  );
  return rest;
};

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
  '\n\n',
  '[DONE]',
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

// Splits a string into fragments at code point boundaries; a fragment may be empty
function fragments(text: string, random: Random, allowEmpty = false): string[] {
  const points = Array.from(text);
  const parts: string[] = [];
  let start = 0;
  while (start < points.length) {
    const size = (allowEmpty ? 0 : 1) + random.int(6);
    parts.push(points.slice(start, start + size).join(''));
    start += size;
  }
  return parts.length ? parts : [''];
}

const META = {
  id: 'chatcmpl-Scn0001',
  object: 'chat.completion.chunk' as const,
  created: 1761130000,
  model: 'gpt-4o-mini-2024-07-18',
  system_fingerprint: 'fp_scenario'
};
const chunkOf = (
  choices: ChatCompletionChunk['choices'],
  usage: ChatCompletionChunk['usage'] = null
): ChatCompletionChunk => ({ ...META, choices, usage });
const USAGE = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 };

describe(`random network splits of each fixture (seed ${BASE_SEED})`, () => {
  describe.each(COMPLETED_FIXTURES)('the %s stream', (name) => {
    it('accumulates to the unsplit result, with the same events, and choice 0 text equals the text deltas', async () => {
      const bytes = readSse(name);
      const baseline = await run(eventChunks(bytes));
      expect(baseline.completion).toEqual(readProjection(name));
      const expectedText = choiceZeroText(baseline.completion!);
      expect(textOf(baseline.events)).toBe(expectedText);

      await forEachSeed(`openai split ${name}`, async (random) => {
        const { completion, events, error } = await run(randomSplit(bytes, random));

        expect(error).toBeUndefined();
        expect(completion).toEqual(baseline.completion);
        expect(events).toEqual(baseline.events);
        expect(textOf(events)).toBe(expectedText);
      });
    });
  });

  it('splits land inside multi-byte code points', async () => {
    const bytes = readSse('utf8-split');
    let insideCodePoint = 0;
    await forEachSeed('openai split coverage', (random) => {
      if (randomSplit(bytes, random).some((chunk) => chunk.length > 0 && (chunk[0]! & 0xc0) === 0x80)) {
        insideCodePoint++;
      }
    });

    expect(insideCodePoint).toBeGreaterThan(ITERATIONS / 4);
  });

  it('the same splits on openai-v4 give the same result', async () => {
    for (const name of COMPLETED_FIXTURES) {
      const bytes = readSse(name);
      const baseline = await run(eventChunks(bytes));
      await forEachSeed(
        `openai-v4 split ${name}`,
        async (random) => {
          const { completion, events } = await run(randomSplit(bytes, random), { client: openAiV4 });

          expect(completion).toEqual(baseline.completion);
          expect(events).toEqual(baseline.events);
        },
        20
      );
    }
  });

  it('CRLF line ends give the same result', async () => {
    for (const name of COMPLETED_FIXTURES) {
      const crlf = encoder.encode(new TextDecoder().decode(readSse(name)).replace(/\n/g, '\r\n'));
      const baseline = await run(eventChunks(readSse(name)));
      await forEachSeed(
        `openai crlf ${name}`,
        async (random) => {
          const { completion, events } = await run(randomSplit(crlf, random));

          expect(completion).toEqual(baseline.completion);
          expect(events).toEqual(baseline.events);
        },
        20
      );
    }
  });

  it('a mid-stream error rejects with the same SDK error however the bytes are split', async () => {
    const bytes = readSse('mid-stream-error');
    const expected = readProjection<{ error: object; textBeforeError: string }>('mid-stream-error');

    await forEachSeed('openai split mid-stream-error', async (random) => {
      const { error, events } = await run(randomSplit(bytes, random));

      expect(error).toBeInstanceOf(APIError);
      expect(error).toMatchObject({ status: undefined, error: expected.error });
      expect(isRetryableError(error)).toBe(true);
      expect(textOf(events)).toBe(expected.textBeforeError);
    });
  });
});

// Where each SSE event ends, and how many events the stream needs before every choice has finished
function eventLayout(name: string) {
  const bytes = readSse(name);
  const ends: number[] = [];
  for (const chunk of eventChunks(bytes)) ends.push((ends.at(-1) ?? 0) + chunk.length);
  const chunks = parseSse(name);
  const finishedAfter = chunks.findIndex((_, i) => {
    try {
      accumulateChatCompletion(chunks.slice(0, i + 1));
      return true;
    } catch {
      return false;
    }
  });
  const usageAt = lastIndexWhere(chunks, (chunk) => chunk.usage);
  return { bytes, ends, finishedAfter, usageAt };
}

describe(`a connection that closes early (seed ${BASE_SEED})`, () => {
  it.each(COMPLETED_FIXTURES)(
    'the %s stream dropped by the socket at a random chunk rejects with a retryable error',
    async (name) => {
      const bytes = readSse(name);

      await forEachSeed(`openai socket drop ${name}`, async (random) => {
        const chunks = randomSplit(bytes, random);
        const client = random.chance(0.5) ? openAiV7 : openAiV4;
        const { completion, error } = await run(chunks, { client, failAt: random.int(chunks.length) });

        expect(completion).toBeUndefined();
        expect(isRetryableError(error), errorText(error)).toBe(true);
      });
    }
  );

  it.each(COMPLETED_FIXTURES)(
    'the %s stream closed after a random event before the last finish rejects with a retryable error',
    async (name) => {
      const { bytes, ends, finishedAfter } = eventLayout(name);
      const baseline = await run(eventChunks(bytes));

      await forEachSeed(`openai close before finish ${name}`, async (random) => {
        const cut = random.int(finishedAfter + 1) === 0 ? 0 : ends[random.int(finishedAfter)]!;
        const { error, events } = await run(randomSplit(bytes.slice(0, cut), random));

        expect(error, `closed at byte ${cut}`).toBeDefined();
        expect(isRetryableError(error), `closed at byte ${cut}: ${errorText(error)}`).toBe(true);
        expect(events).toEqual(baseline.events.slice(0, events.length));
      });
    }
  );

  it.each(COMPLETED_FIXTURES)(
    'the %s stream closed right after its last chunk, without [DONE], resolves with the full result',
    async (name) => {
      const { bytes, ends } = eventLayout(name);
      const baseline = await run(eventChunks(bytes));

      await forEachSeed(`openai close before done ${name}`, async (random) => {
        const { completion, events } = await run(randomSplit(bytes.slice(0, ends.at(-2)!), random));

        expect(completion).toEqual(baseline.completion);
        expect(events).toEqual(baseline.events);
      });
    }
  );

  // Every chunk arrived, so a [DONE] line cut short loses nothing
  it('a stream closed inside the [DONE] line resolves with the full result', async () => {
    const { bytes, ends } = eventLayout('text');
    const baseline = await run(eventChunks(bytes));

    const { completion, error } = await run([bytes.slice(0, ends.at(-2)! + 'data: [DO'.length)]);

    expect(errorText(error)).toBe('undefined: undefined');
    expect(completion).toEqual(baseline.completion);
  });

  // The SDK fails to parse the partial event; the call rejects with a retryable connection error instead
  it.each(COMPLETED_FIXTURES)('the %s stream closed inside an event rejects with a retryable error', async (name) => {
    const { bytes, ends, finishedAfter } = eventLayout(name);

    await forEachSeed(`openai close inside event ${name}`, async (random) => {
      const event = random.int(finishedAfter + 1);
      const from = event === 0 ? 0 : ends[event - 1]!;
      // A cut after the event's first few bytes and before the last byte of its JSON. A cut right after the JSON
      // leaves a whole event, which the SDK parses, so it is not inside the event
      const cut = from + 7 + random.int(ends[event]! - from - 9);
      const { error } = await run(randomSplit(bytes.slice(0, cut), random));

      expect(isRetryableError(error), `closed at byte ${cut}: ${errorText(error)}`).toBe(true);
    });
  });

  it('on openai-v4 a stream closed inside an event rejects with a retryable error', async () => {
    for (const name of COMPLETED_FIXTURES) {
      const { bytes, ends, finishedAfter } = eventLayout(name);
      await forEachSeed(
        `openai-v4 close inside event ${name}`,
        async (random) => {
          const event = random.int(finishedAfter + 1);
          const from = event === 0 ? 0 : ends[event - 1]!;
          const cut = from + 7 + random.int(ends[event]! - from - 8);
          const { error } = await run(randomSplit(bytes.slice(0, cut), random), { client: openAiV4 });

          expect(isRetryableError(error), `closed at byte ${cut}: ${errorText(error)}`).toBe(true);
        },
        20
      );
    }
  });

  // Every choice has finished, so the reply stands without its usage, and token accounting falls back to 500 tokens
  it.each(COMPLETED_FIXTURES.filter((name) => eventLayout(name).usageAt > eventLayout(name).finishedAfter))(
    'the %s stream closed between the finish and the usage resolves without the usage',
    async (name) => {
      const { bytes, ends, finishedAfter } = eventLayout(name);
      const baseline = await run(eventChunks(bytes));

      const { completion, error } = await run(eventChunks(bytes.slice(0, ends[finishedAfter]!)));

      expect(error).toBeUndefined();
      expect(completion?.usage).toBeUndefined();
      expect(completion).toEqual({ ...baseline.completion, usage: undefined });
    }
  );
});

describe(`random text in random deltas (seed ${BASE_SEED})`, () => {
  it('the text deltas and the message content equal the text, however it is split', async () => {
    await forEachSeed('openai random text', async (random) => {
      const text = randomText(random, 40);
      const chunks = [
        chunkOf([{ index: 0, delta: { role: 'assistant', content: '', refusal: null }, finish_reason: null }]),
        ...fragments(text, random).map((delta) =>
          chunkOf([{ index: 0, delta: { content: delta }, finish_reason: null }])
        ),
        chunkOf([{ index: 0, delta: {}, finish_reason: 'stop' }]),
        chunkOf([], USAGE)
      ];
      const { completion, events, error } = await run(randomSplit(toSse(chunks), random));

      expect(error).toBeUndefined();
      expect(completion?.choices[0]?.message.content).toBe(text);
      expect(textOf(events)).toBe(text);
      expect(completion).toEqual(accumulateChatCompletion(chunks));
      expect(events.at(-1)).toMatchObject({ type: 'usage', usage: { totalTokens: 30 } });
    });
  });
});

interface ToolPlan {
  id: string;
  name: string;
  args: string;
}

// Random tools whose names, ids and arguments carry markers that must never reach an event
function randomTools(random: Random, count: number): ToolPlan[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `call_SECRETID${i}x${random.int(1000)}`,
    name: `tool_SECRETNAME_${i}`,
    args: JSON.stringify({
      query: `SECRETARG ${randomText(random, 6)}`,
      n: random.int(100),
      nested: { ok: i % 2 === 0 }
    })
  }));
}

// The tool-call deltas of one tool: the opening delta (with an empty or a first piece of the arguments), then pieces
function toolDeltas(tool: ToolPlan, index: number, random: Random): ChatCompletionChunk.Choice.Delta.ToolCall[] {
  const pieces = fragments(tool.args, random, true);
  const first = random.chance(0.5) ? '' : pieces.shift()!;
  return [
    { index, id: tool.id, type: 'function', function: { name: tool.name, arguments: first } },
    ...pieces.map((piece) => ({ index, function: { arguments: piece } }))
  ];
}

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

describe(`parallel tool calls (seed ${BASE_SEED})`, () => {
  it('random interleavings of the tool-call deltas accumulate to every call, in index order, and never leak', async () => {
    await forEachSeed('openai parallel tools', async (random) => {
      const tools = randomTools(random, 1 + random.int(5));
      const leading = random.chance(0.3) ? randomText(random, 8) : '';
      const deltas = interleave(
        tools.map((tool, index) => toolDeltas(tool, index, random)),
        random
      );
      // Some chunks carry deltas of two different tools
      const toolChunks: ChatCompletionChunk[] = [];
      for (let i = 0; i < deltas.length; i++) {
        const group = [deltas[i]!];
        if (random.chance(0.25) && deltas[i + 1] && deltas[i + 1]!.index !== deltas[i]!.index) group.push(deltas[++i]!);
        toolChunks.push(chunkOf([{ index: 0, delta: { tool_calls: group }, finish_reason: null }]));
      }
      const chunks = [
        chunkOf([{ index: 0, delta: { role: 'assistant', content: null, refusal: null }, finish_reason: null }]),
        ...(leading ? [chunkOf([{ index: 0, delta: { content: leading }, finish_reason: null }])] : []),
        ...toolChunks,
        chunkOf([{ index: 0, delta: {}, finish_reason: 'tool_calls' }]),
        chunkOf([], USAGE)
      ];

      const { completion, events, error } = await run(randomSplit(toSse(chunks), random));

      expect(error).toBeUndefined();
      expect(completion?.choices[0]?.message.tool_calls).toEqual(
        tools.map(({ id, name, args }) => ({ id, type: 'function', function: { name, arguments: args } }))
      );
      expect(completion?.choices[0]?.message.content).toBe(leading || null);
      expect(textOf(events)).toBe(leading);
      expect(events.filter((event) => event.type === 'activity')).toHaveLength(toolChunks.length);
      expect(JSON.stringify(events)).not.toMatch(/SECRET/);
    });
  });

  it('random interleavings of the parallel-tools fixture accumulate to its projection', async () => {
    const chunks = parseSse('parallel-tools');
    const [role, ...rest] = chunks;
    const finishAt = rest.findIndex((chunk) => chunk.choices[0]?.finish_reason);
    const toolChunks = rest.slice(0, finishAt);
    const byTool = [0, 1].map((index) =>
      toolChunks.filter((chunk) => chunk.choices[0]?.delta.tool_calls?.[0]?.index === index)
    );

    await forEachSeed('openai parallel-tools fixture', async (random) => {
      const reordered = [role!, ...interleave(byTool, random), ...rest.slice(finishAt)];
      const { completion, events } = await runChunks(reordered);

      expect(completion).toEqual(readProjection('parallel-tools'));
      expect(events.filter((event) => event.type === 'activity')).toHaveLength(toolChunks.length);
      expect(textOf(events)).toBe('');
    });
  });

  it('random interleavings of two choices keep the first choice text and the second out of the events', async () => {
    const chunks = parseSse('n2');
    const usage = chunks.filter((chunk) => chunk.usage);
    const choiceChunks = chunks.filter((chunk) => !chunk.usage);
    const byChoice = [0, 1].map((index) => choiceChunks.filter((chunk) => chunk.choices[0]?.index === index));

    await forEachSeed('openai n2 interleaving', async (random) => {
      const merged = interleave(byChoice, random);
      // Some chunks carry both choices
      const reordered: ChatCompletionChunk[] = [];
      for (let i = 0; i < merged.length; i++) {
        const next = merged[i + 1];
        if (next && random.chance(0.3) && next.choices[0]?.index !== merged[i]!.choices[0]?.index) {
          reordered.push({ ...merged[i]!, choices: [...merged[i]!.choices, ...next.choices] });
          i++;
        } else {
          reordered.push(merged[i]!);
        }
      }
      const { completion, events } = await runChunks([...reordered, ...usage]);

      expect(completion).toEqual(readProjection('n2'));
      expect(textOf(events)).toBe('Red sky');
      expect(JSON.stringify(events)).not.toMatch(/Blue|apple/);
      const secondChoiceText = reordered.filter((chunk) =>
        chunk.choices.some((choice) => choice.index === 1 && choice.delta.content)
      );
      expect(events.filter((event) => event.type === 'activity')).toHaveLength(secondChoiceText.length);
    });
  });
});

// Chunks that carry nothing: no choices, an empty delta, null text, an empty tool-call list
const EMPTY_CHOICES: ChatCompletionChunk['choices'][] = [
  [],
  [{ index: 0, delta: {}, logprobs: null, finish_reason: null }],
  [{ index: 0, delta: { content: null, refusal: null }, finish_reason: null }],
  [{ index: 0, delta: { tool_calls: [] }, finish_reason: null }],
  [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
];

// The fields that name the completion, copied from a neighbouring chunk so the inserted chunk belongs to the stream
const metaOf = (chunk: ChatCompletionChunk) => {
  const { id, object, created, model, system_fingerprint, service_tier } = chunk;
  return {
    id,
    object,
    created,
    model,
    ...(system_fingerprint !== undefined && { system_fingerprint }),
    ...(service_tier !== undefined && { service_tier })
  };
};

describe(`empty and usage-only chunks (seed ${BASE_SEED})`, () => {
  describe.each(COMPLETED_FIXTURES)('in the %s stream', (name) => {
    it('change neither the result nor the text and activity events; usage-only chunks emit only usage', async () => {
      const chunks = parseSse(name);
      const baseline = await runChunks(chunks);
      const lastUsage = lastIndexWhere(chunks, (chunk) => chunk.usage);

      await forEachSeed(`openai empty chunks ${name}`, async (random) => {
        const mixed = [...chunks];
        let usageOnly = 0;
        for (let n = 1 + random.int(6); n > 0; n--) {
          // A usage-only chunk goes before the real usage, which must stay the last
          const insertUsage = lastUsage >= 0 && random.chance(0.4);
          const at = random.int((insertUsage ? lastIndexWhere(mixed, (chunk) => chunk.usage) : mixed.length) + 1);
          const meta = metaOf(mixed[Math.min(at, mixed.length - 1)]!);
          if (insertUsage) {
            usageOnly++;
            mixed.splice(at, 0, { ...meta, choices: [], usage: { ...USAGE, total_tokens: random.int(1000) } });
          } else {
            mixed.splice(at, 0, {
              ...meta,
              choices: random.pick(EMPTY_CHOICES),
              ...(random.chance(0.5) && { usage: null })
            });
          }
        }
        // Some providers pad every chunk with a random field to hide its size
        if (random.chance(0.3)) {
          for (const [i, chunk] of mixed.entries()) {
            mixed[i] = { ...chunk, obfuscation: randomText(random, 3) } as ChatCompletionChunk;
          }
        }

        const { completion, events } = await runChunks(mixed);
        const withoutUsage = (list: Strategy.LLM.LlmStreamEvent[]) => list.filter((event) => event.type !== 'usage');

        expect(completion).toEqual(baseline.completion);
        expect(withoutUsage(events)).toEqual(withoutUsage(baseline.events));
        expect(events.filter((event) => event.type === 'usage')).toHaveLength(
          baseline.events.filter((event) => event.type === 'usage').length + usageOnly
        );
        expect(events[lastIndexWhere(events, (event) => event.type === 'usage')]).toEqual(
          baseline.events[lastIndexWhere(baseline.events, (event) => event.type === 'usage')]
        );
      });
    });
  });

  it('an empty content delta in a tool-call stream leaves the unified message unchanged', async () => {
    const chunks = parseSse('tool-calls');
    const baseline = await runChunks(chunks);

    await forEachSeed('openai empty content in tool stream', async (random) => {
      const mixed = [...chunks];
      const at = random.int(mixed.length);
      mixed.splice(at, 0, {
        ...metaOf(mixed[at]!),
        choices: [{ index: 0, delta: { content: '' }, finish_reason: null }]
      });
      const { completion, events } = await runChunks(mixed);

      expect(unified(completion)).toEqual(unified(baseline.completion));
      expect(events).toEqual(baseline.events);
    });
  });
});

describe.each([
  ['openai', openAiV7],
  ['openai-v4', openAiV4]
])(`an abort at a random point on %s (seed ${BASE_SEED})`, (clientName, client) => {
  const expectAbort = (error: unknown) => {
    expect(error).toBeInstanceOf(APIUserAbortError);
    expect(isRetryableError(error)).toBe(false);
  };

  it.each(COMPLETED_FIXTURES)('before a random network chunk of %s rejects with the SDK abort error', async (name) => {
    const bytes = readSse(name);
    const fullText = textOf((await run(eventChunks(bytes))).events);

    await forEachSeed(
      `${clientName} abort chunk ${name}`,
      async (random) => {
        const chunks = randomSplit(bytes, random);
        const abortAt = random.int(chunks.length + 1);
        const controller = new AbortController();
        const { error, completion, events } = await run(chunks, {
          client,
          signal: controller.signal,
          beforeChunk: (index) => index === abortAt && controller.abort()
        });

        expect(completion).toBeUndefined();
        expectAbort(error);
        expect(fullText.startsWith(textOf(events))).toBe(true);
      },
      clientName === 'openai' ? ITERATIONS : 20
    );
  });

  it.each(COMPLETED_FIXTURES)('on a random event of %s rejects with the SDK abort error', async (name) => {
    const bytes = readSse(name);
    const baseline = await run(eventChunks(bytes));

    await forEachSeed(
      `${clientName} abort event ${name}`,
      async (random) => {
        const abortOn = random.int(baseline.events.length);
        const controller = new AbortController();
        let seen = 0;
        const { error, events } = await run(randomSplit(bytes, random), {
          client,
          signal: controller.signal,
          sink: () => seen++ === abortOn && controller.abort()
        });

        expectAbort(error);
        expect(events).toEqual(baseline.events.slice(0, events.length));
        expect(events.length).toBeGreaterThan(abortOn);
      },
      clientName === 'openai' ? ITERATIONS : 20
    );
  });
});

describe(`the Azure call strategy over random splits (seed ${BASE_SEED})`, () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_BASE_URL', '');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const newAzure = () =>
    new AzureOpenAiCallStrategy(
      {
        endpoint: 'https://contoso.openai.azure.com',
        deploymentName: 'prod-chat',
        auth: { type: 'api-key', apiKey: 'k' }
      },
      {} as Strategy.LLM.LlmTokenRateLimiter,
      {} as Strategy.LLM.LlmTokenizer,
      { clientOptions: { maxRetries: 0 } }
    );

  it.each(['azure-prompt-filter', 'content-filter-midstream', 'utf8-split', 'parallel-tools'])(
    'generate on %s resolves with the projection and choice 0 text',
    async (name) => {
      const bytes = readSse(name);
      const projection = readProjection(name);

      await forEachSeed(`azure split ${name}`, async (random) => {
        vi.stubGlobal('fetch', fakeFetch(randomSplit(bytes, random)).fetch);
        const events: Strategy.LLM.LlmStreamEvent[] = [];

        const response = await newAzure().generate<OpenAiRequest, ChatCompletion>(REQUEST, {
          onEvent: (event) => void events.push(event)
        });

        expect(response).toEqual(projection);
        expect(textOf(events)).toBe(choiceZeroText(projection));
      });
    }
  );

  it('generate rejects with the SDK abort error when aborted at a random chunk', async () => {
    const bytes = readSse('azure-prompt-filter');

    await forEachSeed('azure abort', async (random) => {
      const chunks = randomSplit(bytes, random);
      const abortAt = random.int(chunks.length + 1);
      const controller = new AbortController();
      vi.stubGlobal('fetch', fakeFetch(chunks, (index) => index === abortAt && controller.abort()).fetch);

      const error = await newAzure()
        .generate(REQUEST, { signal: controller.signal, onEvent: () => {} })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(APIUserAbortError);
    });
  });
});
