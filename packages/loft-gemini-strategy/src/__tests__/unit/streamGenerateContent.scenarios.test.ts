import * as fs from 'node:fs';
import * as path from 'node:path';

import { ApiError, GenerateContentResponse, GoogleGenAI, Part } from '@google/genai';
import { isRetryableError, Logger, Strategy, Type } from '@moc-global/loft-definitions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GeminiCallStrategy } from '../../gemini/GeminiCallStrategy';
import { GeminiLoftStrategy } from '../../gemini/GeminiLoftStrategy';
import { accumulateGenerateContent } from '../../gemini/streaming/accumulateGenerateContent';
import { streamGenerateContent } from '../../gemini/streaming/streamGenerateContent';
import { GeminiRequest } from '../../VertexAiTypes';

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
const FIXTURES = [
  'text',
  'function-call',
  'parallel-function-calls',
  'thinking',
  'usage-last',
  'safety-block',
  'prompt-blocked',
  'two-candidates'
];

interface Fixture {
  chunks: GenerateContentResponse[];
  response: GenerateContentResponse;
}

const toResponse = (value: object) => Object.assign(new GenerateContentResponse(), value);

function readFixture(name: string): Fixture {
  const { chunks, response } = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8')) as {
    chunks: object[];
    response: object;
  };
  return { chunks: chunks.map(toResponse), response: toResponse(response) };
}

// The Gemini API ends each event with a blank CRLF line
const encoder = new TextEncoder();
const toSse = (chunks: object[]): Uint8Array =>
  encoder.encode(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\r\n\r\n`).join(''));
const eventChunks = (chunks: object[]): Uint8Array[] => chunks.map((chunk) => toSse([chunk]));

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
  return async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
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
}

interface RunOptions {
  signal?: AbortSignal;
  sink?: (event: Strategy.LLM.LlmStreamEvent) => void;
  beforeChunk?: (index: number) => void;
  failAt?: number;
}

// Streams through the real SDK over a fake fetch, as the call strategy does
async function run(chunks: Uint8Array[], options: RunOptions = {}) {
  vi.stubGlobal('fetch', fakeFetch(chunks, options.beforeChunk, options.failAt));
  const ai = new GoogleGenAI({ apiKey: 'test-key' });
  const events: Strategy.LLM.LlmStreamEvent[] = [];
  const onEvent: Strategy.LLM.LlmStreamSink = (event) => {
    events.push(event);
    options.sink?.(event);
  };
  const open = () =>
    ai.models.generateContentStream({
      model: 'gemini-test',
      contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
      config: { abortSignal: options.signal }
    });
  const result = await streamGenerateContent(open, { signal: options.signal, onEvent }).then(
    (response) => ({ response, error: undefined }),
    (error: unknown) => ({ response: undefined, error })
  );
  return { ...result, events };
}

// Feeds chunks straight to the streamer, without the SDK
async function runChunks(chunks: GenerateContentResponse[]) {
  const events: Strategy.LLM.LlmStreamEvent[] = [];
  const response = await streamGenerateContent(
    async () =>
      (async function* () {
        yield* chunks;
      })(),
    { onEvent: (event) => void events.push(event) }
  );
  return { response, events };
}

// The response without the HTTP details the SDK adds to each chunk, and without `createTime`, which only Vertex AI
// sends: the fixtures come from Vertex AI and these tests use the Gemini API client, which drops it
const withoutHttp = (response: GenerateContentResponse | undefined) => {
  if (!response) return response;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
  const { sdkHttpResponse, createTime, ...rest } = response;
  return rest;
};

// The class and message of an error, for failure messages; the fixtures hold no secrets
const errorText = (error: unknown) =>
  error instanceof Error ? `${error.constructor.name}: ${error.message}` : `${typeof error}: ${String(error)}`;

const deltasOf = (events: Strategy.LLM.LlmStreamEvent[], type: 'text-delta' | 'reasoning-delta' = 'text-delta') =>
  events.map((event) => (event.type === type ? event.delta : '')).join('');
// The first candidate's answer (or thought) text as the chunks send it
const chunkText = (chunks: GenerateContentResponse[], thought = false) =>
  chunks
    .flatMap((chunk) => chunk.candidates?.find((candidate, i) => (candidate.index ?? i) === 0)?.content?.parts ?? [])
    .map((part) => (Boolean(part.thought) === thought ? (part.text ?? '') : ''))
    .join('');
const responseText = (response: GenerateContentResponse, thought = false) =>
  (response.candidates?.[0]?.content?.parts ?? [])
    .map((part) => (Boolean(part.thought) === thought ? (part.text ?? '') : ''))
    .join('');

const loftStrategy = new GeminiLoftStrategy({ llmName: 'gemini' }, {} as Strategy.CallManager);
// The unified response without the original response; tool call ids are generated when Gemini sends none, as in the
// fixtures, so they are left out too
const unified = (response: GenerateContentResponse) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
  const { originalResponse, ...rest } = loftStrategy.formatToUnifiedLLMResponse(
    [],
    's-1',
    response,
    'gemini',
    'assistant'
  );
  const withoutIds = (message: { content: Type.Entity.FullContentPart[] }) => ({
    ...message,
    content: message.content.map((part) => (part.type === 'tool_call' ? { ...part, callId: 'id' } : part))
  });
  return { ...rest, topChoice: withoutIds(rest.topChoice), choices: rest.choices.map(withoutIds) };
};

// Random text with the characters that tend to break stream parsers or byte splits
const TEXT_PIECES = [
  'a',
  'Z',
  ' ',
  '\n',
  '\r\n\r\n',
  '\t',
  '"',
  '\\',
  '/',
  '{',
  '}',
  ':',
  'data: ',
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

const META = { modelVersion: 'gemini-2.5-flash', createTime: '2026-10-22T10:00:00.000000Z', responseId: 'resp-scn' };
const USAGE = { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 };
const chunkOf = (parts: Part[], extra: object = {}) =>
  toResponse({ candidates: [{ content: { role: 'model', parts } }], ...META, ...extra });

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  // The SDK's getters warn when there are two candidates or parts besides text
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe(`random network splits of each fixture (seed ${BASE_SEED})`, () => {
  describe.each(FIXTURES)('the %s stream', (name) => {
    it('accumulates to the unsplit result, with the same events, and the text deltas equal candidate 0 text', async () => {
      const { chunks, response } = readFixture(name);
      const bytes = toSse(chunks);
      const baseline = await run(eventChunks(chunks));
      expect(baseline.error).toBeUndefined();
      expect(withoutHttp(baseline.response)).toEqual(withoutHttp(response));
      expect(deltasOf(baseline.events)).toBe(chunkText(chunks));
      // A blocked candidate has no content, as without streaming, though its text went out as deltas
      if (name !== 'safety-block') expect(deltasOf(baseline.events)).toBe(responseText(response));

      await forEachSeed(`gemini split ${name}`, async (random) => {
        const { response: streamed, events, error } = await run(randomSplit(bytes, random));

        expect(error, errorText(error)).toBeUndefined();
        expect(streamed).toEqual(baseline.response);
        expect(events).toEqual(baseline.events);
      });
    });
  });

  it('LF line ends give the same result', async () => {
    for (const name of FIXTURES) {
      const { chunks } = readFixture(name);
      const lf = encoder.encode(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(''));
      const baseline = await run(eventChunks(chunks));
      await forEachSeed(
        `gemini lf ${name}`,
        async (random) => {
          const { response, events } = await run(randomSplit(lf, random));

          expect(response).toEqual(baseline.response);
          expect(events).toEqual(baseline.events);
        },
        20
      );
    }
  });
});

describe(`random text, thoughts and function calls in random chunks (seed ${BASE_SEED})`, () => {
  it('the deltas equal the text and thoughts, and the parts join as without streaming', async () => {
    await forEachSeed('gemini random text', async (random) => {
      const thought = random.chance(0.5) ? randomText(random, 20) : '';
      const text = randomText(random, 40);
      const parts: Part[] = [
        ...fragments(thought, random)
          .filter(Boolean)
          .map((piece) => ({ text: piece, thought: true })),
        ...fragments(text, random).map((piece) => ({ text: piece }))
      ];
      // One to three parts per chunk; the last chunk finishes with the usage
      const chunks: GenerateContentResponse[] = [];
      for (let i = 0; i < parts.length;) {
        const take = 1 + random.int(3);
        chunks.push(chunkOf(parts.slice(i, i + take)));
        i += take;
      }
      chunks.push(
        toResponse({
          candidates: [
            { content: { role: 'model', parts: [{ text: '', thoughtSignature: 'SECRETSIG' }] }, finishReason: 'STOP' }
          ],
          usageMetadata: USAGE,
          ...META
        })
      );

      const { response, events, error } = await run(randomSplit(toSse(chunks), random));

      expect(error, errorText(error)).toBeUndefined();
      expect(deltasOf(events)).toBe(text);
      expect(deltasOf(events, 'reasoning-delta')).toBe(thought);
      expect(response?.candidates?.[0]?.content?.parts).toEqual([
        ...(thought ? [{ text: thought, thought: true }] : []),
        { text, thoughtSignature: 'SECRETSIG' }
      ]);
      expect(response?.text).toBe(text);
      expect(JSON.stringify(events)).not.toMatch(/SECRET/);
    });
  });

  it('random parallel function calls in random chunks arrive in order and never leak', async () => {
    await forEachSeed('gemini parallel calls', async (random) => {
      const calls = Array.from({ length: 1 + random.int(5) }, (_, i) => ({
        id: `SECRETID-${i}-${random.int(1000)}`,
        name: `tool_SECRETNAME_${i}`,
        args: { query: `SECRETARG ${randomText(random, 6)}`, n: random.int(100) }
      }));
      const leading = random.chance(0.4) ? randomText(random, 8) : '';
      const parts: Part[] = [
        ...(leading ? fragments(leading, random).map((piece) => ({ text: piece })) : []),
        ...calls.map((functionCall, i) => ({
          functionCall,
          ...(i === 0 && { thoughtSignature: 'SECRETSIG' })
        }))
      ];
      const chunks: GenerateContentResponse[] = [];
      for (let i = 0; i < parts.length;) {
        const take = 1 + random.int(3);
        const last = i + take >= parts.length;
        chunks.push(
          toResponse({
            candidates: [
              { content: { role: 'model', parts: parts.slice(i, i + take) }, ...(last && { finishReason: 'STOP' }) }
            ],
            ...(last && { usageMetadata: USAGE }),
            ...META
          })
        );
        i += take;
      }

      const { response, events, error } = await run(randomSplit(toSse(chunks), random));

      expect(error, errorText(error)).toBeUndefined();
      expect(response?.functionCalls).toEqual(calls);
      expect(response?.candidates?.[0]?.content?.parts).toEqual([
        ...(leading ? [{ text: leading }] : []),
        ...calls.map((functionCall, i) => ({ functionCall, ...(i === 0 && { thoughtSignature: 'SECRETSIG' }) }))
      ]);
      expect(deltasOf(events)).toBe(leading);
      expect(events.filter((event) => event.type === 'activity')).toHaveLength(calls.length);
      expect(JSON.stringify(events)).not.toMatch(/SECRET/);
    });
  });

  it('random rechunkings of the two-candidates stream keep candidate 1 out of the events', async () => {
    const { chunks, response } = readFixture('two-candidates');
    // Each candidate's chunks, one candidate per chunk
    const byCandidate = [0, 1].map((index) =>
      chunks.flatMap((chunk) =>
        (chunk.candidates ?? [])
          .filter((candidate, i) => (candidate.index ?? i) === index)
          .map((candidate) => ({ ...chunk, candidates: [candidate] }))
      )
    );

    await forEachSeed('gemini two candidates', async (random) => {
      const queues = byCandidate.map((list) => [...list]);
      const reordered: GenerateContentResponse[] = [];
      while (queues.some((queue) => queue.length)) {
        const open = queues.filter((queue) => queue.length);
        const chunk = random.pick(open).shift()!;
        reordered.push(toResponse({ ...chunk }));
      }
      // The usage goes on the last chunk, as the API sends it
      const usage = response.usageMetadata;
      reordered.forEach((chunk) => delete chunk.usageMetadata);
      reordered.at(-1)!.usageMetadata = usage;

      const { response: streamed, events } = await runChunks(reordered);

      expect(withoutHttp(streamed)).toEqual(withoutHttp(response));
      expect(deltasOf(events)).toBe('Red sky');
      expect(JSON.stringify(events)).not.toMatch(/Blue|sea/);
    });
  });
});

describe(`empty and usage-only chunks (seed ${BASE_SEED})`, () => {
  // Chunks that carry nothing new: only metadata, an empty candidate, an empty text part, a part list with nothing
  // The metadata of the stream's own chunks, so an inserted chunk belongs to it
  type Meta = Pick<GenerateContentResponse, 'modelVersion' | 'responseId' | 'createTime'>;
  const metaOf = ({ modelVersion, responseId, createTime }: GenerateContentResponse): Meta => ({
    modelVersion,
    responseId,
    createTime
  });
  const EMPTY_CHUNKS = [
    (meta: Meta) => toResponse({ ...meta }),
    (meta: Meta) => toResponse({ candidates: [], ...meta }),
    (meta: Meta) => toResponse({ candidates: [{ content: { role: 'model', parts: [] } }], ...meta }),
    (meta: Meta) => toResponse({ candidates: [{ content: { role: 'model', parts: [{ text: '' }] } }], ...meta })
  ];

  describe.each(FIXTURES)('in the %s stream', (name) => {
    it('change neither the unified message nor the text and activity events', async () => {
      const { chunks } = readFixture(name);
      const meta = metaOf(chunks[0]!);
      const baseline = await runChunks(chunks);
      const withoutUsage = (list: Strategy.LLM.LlmStreamEvent[]) => list.filter((event) => event.type !== 'usage');

      await forEachSeed(`gemini empty chunks ${name}`, async (random) => {
        const mixed = [...chunks];
        for (let n = 1 + random.int(5); n > 0; n--) {
          // A usage-only chunk goes before the last usage, which must stay the last
          const lastUsage = lastIndexWhere(mixed, (chunk) => chunk.usageMetadata);
          if (lastUsage >= 0 && random.chance(0.4)) {
            mixed.splice(random.int(lastUsage + 1), 0, toResponse({ usageMetadata: { promptTokenCount: 1 }, ...meta }));
          } else {
            mixed.splice(random.int(mixed.length + 1), 0, random.pick(EMPTY_CHUNKS)(meta));
          }
        }

        const { response, events } = await runChunks(mixed);

        expect(unified(response)).toEqual(unified(baseline.response));
        expect(withoutUsage(events)).toEqual(withoutUsage(baseline.events));
        expect(events[lastIndexWhere(events, (event) => event.type === 'usage')]).toEqual(
          baseline.events[lastIndexWhere(baseline.events, (event) => event.type === 'usage')]
        );
      });
    });
  });

  // An empty text part without a signature is dropped, so it does not stay as its own part after a function call
  it('an empty text part between two function calls leaves the response as without streaming', async () => {
    const { chunks, response } = readFixture('parallel-function-calls');

    await forEachSeed('gemini empty text between calls', async (random) => {
      const mixed = [...chunks];
      mixed.splice(1 + random.int(mixed.length - 1), 0, EMPTY_CHUNKS[3]!(metaOf(chunks[0]!)));

      const { response: streamed } = await runChunks(mixed);

      expect(streamed.candidates?.[0]?.content?.parts).toEqual(response.candidates?.[0]?.content?.parts);
    });
  });
});

describe(`an abort at a random point (seed ${BASE_SEED})`, () => {
  const expectAbort = (error: unknown) => {
    expect(error, errorText(error)).toMatchObject({ name: 'AbortError' });
    expect(isRetryableError(error)).toBe(false);
  };

  it.each(FIXTURES)('before a random network chunk of %s rejects with the abort error', async (name) => {
    const { chunks } = readFixture(name);
    const bytes = toSse(chunks);
    const baseline = await run(eventChunks(chunks));

    await forEachSeed(`gemini abort chunk ${name}`, async (random) => {
      const split = randomSplit(bytes, random);
      const abortAt = random.int(split.length + 1);
      const controller = new AbortController();
      const { error, response, events } = await run(split, {
        signal: controller.signal,
        beforeChunk: (index) => index === abortAt && controller.abort()
      });

      expect(response).toBeUndefined();
      expectAbort(error);
      expect(events).toEqual(baseline.events.slice(0, events.length));
    });
  });

  it.each(FIXTURES)('on a random event of %s rejects with the abort error', async (name) => {
    const { chunks } = readFixture(name);
    const baseline = await run(eventChunks(chunks));

    await forEachSeed(`gemini abort event ${name}`, async (random) => {
      const abortOn = random.int(baseline.events.length);
      const controller = new AbortController();
      let seen = 0;
      const { error, events } = await run(randomSplit(toSse(chunks), random), {
        signal: controller.signal,
        sink: () => seen++ === abortOn && controller.abort()
      });

      expectAbort(error);
      expect(events).toEqual(baseline.events.slice(0, events.length));
    });
  });
});

describe(`a connection that fails or closes early (seed ${BASE_SEED})`, () => {
  it.each(FIXTURES)(
    'the %s stream dropped by the socket at a random chunk rejects with a retryable error',
    async (name) => {
      const bytes = toSse(readFixture(name).chunks);

      await forEachSeed(`gemini socket drop ${name}`, async (random) => {
        const split = randomSplit(bytes, random);
        const { response, error } = await run(split, { failAt: random.int(split.length) });

        expect(response).toBeUndefined();
        expect(isRetryableError(error), errorText(error)).toBe(true);
      });
    }
  );

  it.each(FIXTURES.filter((name) => readFixture(name).chunks.length > 1))(
    'the %s stream closed after a random event before the finish rejects with a retryable error',
    async (name) => {
      const { chunks } = readFixture(name);

      await forEachSeed(`gemini close at event ${name}`, async (random) => {
        const kept = chunks.slice(0, random.int(chunks.length - 1) + 1);
        const finished = accumulates(kept);
        const { response, error } = await run(randomSplit(toSse(kept), random));

        if (finished) expect(error).toBeUndefined();
        else expect(isRetryableError(error), `closed after ${kept.length} chunks: ${errorText(error)}`).toBe(true);
        if (!finished) expect(response).toBeUndefined();
      });
    }
  );

  // The SDK's plain Error for a stream closed inside an event becomes the retryable 502 of a close between events.
  // When every candidate had finished before the cut event (a trailing usage chunk), the reply stands
  it.each(FIXTURES)(
    'the %s stream closed inside an event rejects with a retryable error, unless every candidate had finished',
    async (name) => {
      const { chunks } = readFixture(name);
      const bytes = toSse(chunks);

      await forEachSeed(`gemini close inside event ${name}`, async (random) => {
        const event = random.int(chunks.length);
        const from = toSse(chunks.slice(0, event)).length;
        const to = from + toSse([chunks[event]!]).length;
        // After the event's first bytes and before its blank line
        const cut = from + 7 + random.int(to - from - 10);
        const finished = accumulates(chunks.slice(0, event));
        const { response, error } = await run(randomSplit(bytes.slice(0, cut), random));

        if (finished) {
          expect(error, `closed at byte ${cut}`).toBeUndefined();
          expect(response).toEqual((await run(eventChunks(chunks.slice(0, event)))).response);
        } else {
          expect(isRetryableError(error), `closed at byte ${cut}: ${errorText(error)}`).toBe(true);
        }
      });
    }
  );

  it('an error object sent in its own read rejects with the SDK error', async () => {
    const { chunks } = readFixture('text');
    const failure = { error: { code: 503, message: 'The model is overloaded.', status: 'UNAVAILABLE' } };

    await forEachSeed('gemini error object', async (random) => {
      const before = random.int(chunks.length);
      const { error, events } = await run([
        ...randomSplit(toSse(chunks.slice(0, before)), random).filter((chunk) => chunk.length),
        encoder.encode(JSON.stringify(failure))
      ]);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 503 });
      expect(isRetryableError(error)).toBe(true);
      expect(deltasOf(events)).toBe(chunkText(chunks.slice(0, before)));
    });
  });

  // The SDK only recognises an error object that arrives in one network read; split across reads, its plain Error
  // becomes the retryable 502 (the object's own status is lost)
  it('an error object split across reads rejects with the retryable SDK error', async () => {
    const failure = encoder.encode(
      JSON.stringify({ error: { code: 503, message: 'The model is overloaded.', status: 'UNAVAILABLE' } })
    );

    await forEachSeed('gemini split error object', async (random) => {
      const reads = randomSplit(failure, random).filter((chunk) => chunk.length);
      const { error } = await run(reads);

      expect(error, errorText(error)).toBeInstanceOf(ApiError);
      expect(isRetryableError(error)).toBe(true);
      if (reads.length === 1) {
        expect(error).toMatchObject({ status: 503 });
      } else {
        expect(error).toMatchObject({ status: 502 });
        expect((error as ApiError).cause).toBeInstanceOf(Error);
        expect((error as ApiError).cause).not.toBeInstanceOf(ApiError);
      }
    });
    // One read keeps the object's own status
    expect((await run([failure])).error).toMatchObject({ status: 503 });
  });
});

// True when the chunks make a whole response
function accumulates(chunks: GenerateContentResponse[]): boolean {
  try {
    accumulateGenerateContent(chunks);
    return true;
  } catch {
    return false;
  }
}

describe(`the call strategy over random splits (seed ${BASE_SEED})`, () => {
  const REQUEST: GeminiRequest = {
    model: 'gemini-test',
    contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    config: { temperature: 0.2 }
  };

  it.each(['function-call', 'thinking', 'two-candidates'])(
    'generate on %s resolves with the response',
    async (name) => {
      const { chunks, response } = readFixture(name);
      const bytes = toSse(chunks);

      await forEachSeed(`gemini strategy ${name}`, async (random) => {
        vi.stubGlobal('fetch', fakeFetch(randomSplit(bytes, random)));
        const strategy = new GeminiCallStrategy(
          { mode: 'apikey', apiKey: 'test-key' },
          {} as Strategy.LLM.LlmTokenRateLimiter,
          {} as Strategy.LLM.LlmTokenizer
        );
        const events: Strategy.LLM.LlmStreamEvent[] = [];

        const streamed = await strategy.generate<GeminiRequest, GenerateContentResponse>(REQUEST, {
          onEvent: (event) => void events.push(event)
        });

        expect(withoutHttp(streamed)).toEqual(withoutHttp(response));
        expect(unified(streamed)).toEqual(unified(response));
        expect(deltasOf(events)).toBe(chunkText(chunks));
      });
    }
  );
});
