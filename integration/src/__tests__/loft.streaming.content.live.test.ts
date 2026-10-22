import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';

import {
  AnthropicCallStrategy,
  AnthropicLoftStrategy,
  AnthropicRequest,
  AnthropicResponse
} from '@moc-global/loft-anthropic-strategy';
import { Chat, NativeCallManagerStrategy, Schema, Type } from '@moc-global/loft-definitions';
import {
  GeminiCallStrategy,
  GeminiLoftStrategy,
  GeminiRequest,
  GeminiResponse
} from '@moc-global/loft-gemini-strategy';
import {
  GenerateCallManager,
  GenerateConfig,
  LlmTokenizer,
  LlmTokenRateLimiter
} from '@moc-global/loft-llm-call-manager';
import {
  OpenAiCallStrategy,
  OpenAiLoftStrategy,
  OpenAiRequest,
  OpenAiResponse
} from '@moc-global/loft-openai-strategy';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { env, hasKeys, requireKey } from './config';
import { initDB, type TestDatabaseInstance } from './initDB';
import { createChatConstructor, createLoftConstructor } from './loftInit';

// Streamed replies of different sizes and shapes against the real providers: short to long text, an image in the
// prompt, diagrams in code fences, tables with many scripts and emoji, deeply nested tool arguments, structured output
// and a long answer after a tool round. Each scenario runs once (a second time only when the model ignored the
// prompt) and prints its event types and timings, never the text.

type StreamEvent = Chat.ChatStreamEvent;
type LoftConstructorType = ReturnType<typeof createLoftConstructor>;
type CallManagerExtras = Pick<GenerateConfig, 'streamIdleTimeoutMs'>;

// Long enough for any healthy stream, short enough to fail a run that stalls
const IDLE_TIMEOUT_MS = 10000;

function limiter() {
  return new LlmTokenRateLimiter({
    newTokensPerSecond: env.LOFT_OPENAI_CALL_STRATEGY_NEW_TOKENS_PER_SECOND,
    newRequestsPerSecond: env.LOFT_OPENAI_CALL_STRATEGY_NEW_REQUESTS_PER_SECOND,
    maxRequests: env.LOFT_OPENAI_CALL_STRATEGY_MAX_REQUESTS,
    maxTokens: env.LOFT_OPENAI_CALL_STRATEGY_MAX_TOKENS,
    maxAwaitSeconds: env.LOFT_OPENAI_CALL_STRATEGY_MAX_AWAIT_SECONDS
  });
}

function generateConfig(extras: CallManagerExtras): GenerateConfig {
  return {
    highPriorityTasksLimit: env.LOFT_OPENAI_CALL_MANAGER_HIGH_PRIORITY_TASKS_LIMIT,
    retryDelay: env.LOFT_OPENAI_CALL_MANAGER_RETRY_DELAY,
    retryAttemptsLimit: env.LOFT_OPENAI_CALL_MANAGER_RETRY_ATTEMPTS_LIMIT,
    ...extras
  };
}

interface ProviderCase {
  label: string;
  key: 'LOFT_OPENAI_API_KEY' | 'LOFT_ANTHROPIC_API_KEY' | 'LOFT_GEMINI_VERTEX_PROJECT';
  llmName: string;
  /** A model entry with a nested JSON schema for its reply, when the strategy can send one */
  structuredLlmName?: string;
  /** Whether the strategy streams the request with the JSON schema */
  structuredStreams: boolean;
  /**
   * Declare nullable values OpenAPI-style (`nullable: true`) in the tool scenarios; the type-list spelling then has a
   * scenario of its own
   */
  singleTypeToolSchemas: boolean;
  /** A model entry with a 64-token cap, to show whether the cap reaches the provider */
  cappedLlmName: string;
  register(loftConstructor: LoftConstructorType, llmName: string, extras: CallManagerExtras): Promise<void>;
}

const PROVIDERS: ProviderCase[] = [
  {
    label: 'OpenAI',
    key: 'LOFT_OPENAI_API_KEY',
    llmName: 'content-gpt-4o-mini',
    structuredLlmName: 'content-gpt-4o-mini-json-schema',
    structuredStreams: false,
    singleTypeToolSchemas: false,
    cappedLlmName: 'content-gpt-4o-mini-capped',
    register: (loftConstructor, llmName, extras) =>
      loftConstructor.registerLlmStrategy(
        llmName,
        new OpenAiLoftStrategy(
          { llmName },
          new NativeCallManagerStrategy(
            new GenerateCallManager<OpenAiRequest, OpenAiResponse>(
              llmName,
              generateConfig(extras),
              new OpenAiCallStrategy(requireKey('LOFT_OPENAI_API_KEY'), limiter(), new LlmTokenizer())
            )
          )
        )
      )
  },
  {
    label: 'Anthropic',
    key: 'LOFT_ANTHROPIC_API_KEY',
    llmName: 'content-claude-haiku',
    structuredLlmName: 'content-claude-haiku-json-schema',
    structuredStreams: true,
    singleTypeToolSchemas: false,
    cappedLlmName: 'content-claude-haiku-capped',
    register: (loftConstructor, llmName, extras) =>
      loftConstructor.registerLlmStrategy(
        llmName,
        new AnthropicLoftStrategy(
          { llmName },
          new NativeCallManagerStrategy(
            new GenerateCallManager<AnthropicRequest, AnthropicResponse>(
              llmName,
              generateConfig(extras),
              new AnthropicCallStrategy({ apiKey: requireKey('LOFT_ANTHROPIC_API_KEY') }, limiter(), new LlmTokenizer())
            )
          )
        )
      )
  },
  {
    label: 'Gemini',
    key: 'LOFT_GEMINI_VERTEX_PROJECT',
    llmName: 'content-gemini-flash-lite',
    // The Gemini streaming live test covers structured output
    structuredLlmName: undefined,
    structuredStreams: true,
    singleTypeToolSchemas: true,
    cappedLlmName: 'content-gemini-flash-lite-capped',
    register: (loftConstructor, llmName, extras) =>
      loftConstructor.registerLlmStrategy(
        llmName,
        new GeminiLoftStrategy(
          { llmName },
          new NativeCallManagerStrategy(
            new GenerateCallManager<GeminiRequest, GeminiResponse>(
              llmName,
              generateConfig(extras),
              new GeminiCallStrategy(
                {
                  mode: 'vertexai',
                  project: requireKey('LOFT_GEMINI_VERTEX_PROJECT'),
                  location: env.LOFT_GEMINI_VERTEX_LOCATION
                },
                limiter(),
                new LlmTokenizer()
              )
            )
          )
        )
      )
  }
];

// ---- Events ----

const userMessage = (
  content: Type.Entity.FullContentPart[],
  sessionId: string,
  llmName: string
): Type.Entity.CreateMessage => ({
  id: randomUUID(),
  sessionId,
  ctx: {},
  llmName,
  manifestName: 'test-bot',
  content,
  role: Type.LLM.UnifiedMessageRole.user,
  author: 'user',
  llmIgnore: false
});

const textOf = (message: Pick<Type.Entity.Message, 'content'> | undefined) =>
  (message?.content ?? []).map((part) => (part.type === 'text' ? part.text : '')).join('');

function ofType<T extends StreamEvent['type']>(events: StreamEvent[], type: T) {
  return events.filter((event): event is Extract<StreamEvent, { type: T }> => event.type === type);
}

const TERMINAL = new Set(['finish', 'error', 'abort']);

// Every call numbers its events 0, 1, 2… and ends with exactly one terminal event
function expectWellFormed(events: StreamEvent[]) {
  expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
  expect(events.filter((event) => TERMINAL.has(event.type))).toHaveLength(1);
  expect(TERMINAL.has(events.at(-1)?.type ?? '')).toBe(true);
  expect(events[0]?.type).toBe('start');
  expect(new Set(events.map((event) => event.runId)).size).toBe(1);
}

// Steps are numbered from 0 and never interleave; within a step the statuses come first, then the text, then the tools
function expectStepOrder(events: StreamEvent[]) {
  let current: number | undefined;
  const started: number[] = [];
  let inStep: StreamEvent[] = [];
  const checkStep = (stepEvents: StreamEvent[]) => {
    const types = stepEvents.map((event) => (event.type === 'status' ? `status:${event.phase}` : event.type));
    const generating = types.indexOf('status:generating');
    const firstText = types.indexOf('text-delta');
    const lastText = types.lastIndexOf('text-delta');
    const firstTool = types.findIndex((type) => type === 'tool-call' || type === 'data' || type === 'tool-result');
    if (firstText >= 0) expect(generating).toBeLessThan(firstText);
    if (firstTool >= 0 && lastText >= 0) expect(lastText).toBeLessThan(firstTool);
  };
  for (const event of events) {
    if (!('step' in event)) {
      expect(current).toBeUndefined();
      continue;
    }
    if (event.type === 'step-start') {
      expect(current).toBeUndefined();
      current = event.step;
      started.push(event.step);
      inStep = [];
      continue;
    }
    expect(event.step).toBe(current);
    inStep.push(event);
    if (event.type === 'step-finish') {
      checkStep(inStep);
      current = undefined;
    }
  }
  expect(started).toEqual(started.map((_, index) => index));
}

/** The event types of a run, with repeats folded, for the report. No text, arguments or data. */
function sequenceOf(events: StreamEvent[]): string {
  const labels = events.map((event) => {
    switch (event.type) {
      case 'start':
        return `start(${event.textPolicy},${event.streaming ? 'streaming' : 'not-streaming'})`;
      case 'status':
        return `status:${event.phase}#${event.step}`;
      case 'step-start':
      case 'text-delta':
      case 'reasoning-delta':
        return `${event.type}#${event.step}`;
      case 'tool-call':
        return `tool-call(${event.name})#${event.step}`;
      case 'data':
        return `data(${event.toolName})#${event.step}`;
      case 'tool-result':
        return `tool-result(${event.name},${event.status})#${event.step}`;
      case 'step-finish':
        return `step-finish(${event.finishReason},${event.streamed ? 'streamed' : 'not-streamed'})#${event.step}`;
      case 'finish':
        return `finish(${event.finishReason}${event.textReplaced ? ',replaced' : ''})`;
      case 'error':
        return `error(${event.code})`;
      default:
        return event.type;
    }
  });
  const folded: string[] = [];
  for (let index = 0; index < labels.length;) {
    let end = index;
    while (end + 1 < labels.length && labels[end + 1] === labels[index]) end += 1;
    folded.push(end > index ? `${labels[index]}x${end - index + 1}` : labels[index]);
    index = end + 1;
  }
  return folded.join(' ');
}

// ---- Measurements ----

interface Measured {
  events: StreamEvent[];
  result: Chat.GenerateResult;
  finish: Extract<StreamEvent, { type: 'finish' }>;
  /** The text-deltas of the last step, which hold the final answer */
  finalDeltas: string[];
  metrics: string;
  maxGapMs: number;
}

// `events` receives every event as it arrives, so a caller still has them when generate() rejects
async function measure(
  start: (onEvent: (event: StreamEvent) => void) => Promise<Chat.GenerateResult>,
  events: StreamEvent[] = []
) {
  const deltaTimes: number[] = [];
  const heapBefore = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  const result = await start((event) => {
    events.push(event);
    if (event.type === 'text-delta') deltaTimes.push(performance.now());
  });
  const totalMs = performance.now() - startedAt;
  const maxGapMs = Math.max(0, ...deltaTimes.slice(1).map((time, index) => time - deltaTimes[index]));
  const [finish] = ofType(events, 'finish');
  const lastStep = ofType(events, 'step-finish').at(-1)?.step;
  const finalDeltas = ofType(events, 'text-delta')
    .filter((event) => event.step === lastStep)
    .map((event) => event.delta);
  const heapMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
  const metrics = [
    `deltas=${ofType(events, 'text-delta').length}`,
    `out=${finish?.usage.outputTokens ?? 'n/a'}`,
    `chars=${finish?.text.length ?? 'n/a'}`,
    `ttfd=${deltaTimes.length > 0 ? Math.round(deltaTimes[0] - startedAt) : 'n/a'}ms`,
    `total=${Math.round(totalMs)}ms`,
    `maxGap=${Math.round(maxGapMs)}ms`,
    `heap=${heapMb.toFixed(1)}MB`
  ].join(' ');
  const measured: Measured = { events, result, finish, finalDeltas, metrics, maxGapMs };
  return measured;
}

function report(provider: ProviderCase, scenario: string, measured: Measured, extra = '') {
  console.info(
    `[content] ${provider.label} | ${scenario} | ${measured.metrics}${extra ? ` | ${extra}` : ''} | ${sequenceOf(measured.events)}`
  );
}

// A model that ignored the prompt (no tool call, wrong format) gets one more try; the retry is printed
async function retryOnce(provider: ProviderCase, scenario: string, attempt: () => Promise<void>) {
  try {
    await attempt();
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0].slice(0, 100) : 'unknown';
    console.info(`[content] ${provider.label} | ${scenario} | RETRY after: ${reason}`);
    await attempt();
  }
}

// The checks every successful run makes: well-formed, one finish, the final step's deltas are the answer
function expectStreamedAnswer(measured: Measured) {
  expectWellFormed(measured.events);
  expectStepOrder(measured.events);
  expect(ofType(measured.events, 'error')).toHaveLength(0);
  expect(measured.finish).toBeDefined();
  expect(measured.finish.text).toBe(measured.finalDeltas.join(''));
  expect(measured.finish.textReplaced).toBe(false);
  expect(measured.maxGapMs).toBeLessThan(IDLE_TIMEOUT_MS);
}

// ---- Text checks ----

// A string without a high surrogate missing its low half, or a low surrogate without its high half
function isWellFormedText(text: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
}

// How many delta boundaries fall inside a grapheme (an emoji ZWJ sequence, a flag, a letter with its mark)
function deltaBoundariesInsideGraphemes(deltas: string[]): number {
  const text = deltas.join('');
  const starts = new Set<number>();
  for (const segment of new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)) starts.add(segment.index);
  let offset = 0;
  let inside = 0;
  for (const delta of deltas.slice(0, -1)) {
    offset += delta.length;
    if (!starts.has(offset)) inside += 1;
  }
  return inside;
}

// ---- A small PNG: a red disc on a white square ----

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function redDiscPng(size = 64): string {
  const rows: Buffer[] = [];
  const centre = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x += 1) {
      const inside = (x - centre) ** 2 + (y - centre) ** 2 <= (size * 0.36) ** 2;
      row.set(inside ? [220, 20, 30] : [255, 255, 255], 1 + x * 3);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0))
  ]).toString('base64');
}

// ---- JSON schemas ----

interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  nullable?: boolean;
  additionalProperties?: boolean;
}

// The errors of a value against the subset of JSON Schema the scenarios use
function schemaErrors(schema: JsonSchema, value: unknown, path = '$'): string[] {
  if (schema.anyOf) {
    return schema.anyOf.some((option) => schemaErrors(option, value, path).length === 0)
      ? []
      : [`${path}: matches no anyOf option`];
  }
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  const typeOf = (candidate: string) => {
    switch (candidate) {
      case 'null':
        return value === null;
      case 'integer':
        return Number.isInteger(value);
      case 'number':
        return typeof value === 'number' && Number.isFinite(value);
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      default:
        return typeof value === candidate;
    }
  };
  if (types.length > 0 && !types.some(typeOf)) return [`${path}: expected ${types.join('|')}`];
  if (value === null) return [];
  const errors: string[] = [];
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not one of the enum values`);
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => errors.push(...schemaErrors(schema.items ?? {}, item, `${path}[${index}]`)));
  }
  if (typeof value === 'object' && !Array.isArray(value) && schema.properties) {
    const record = value as Record<string, unknown>;
    for (const name of schema.required ?? []) if (!(name in record)) errors.push(`${path}.${name}: missing`);
    for (const [name, child] of Object.entries(record)) {
      const childSchema = schema.properties[name];
      if (childSchema) errors.push(...schemaErrors(childSchema, child, `${path}.${name}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${name}: not allowed`);
    }
  }
  return errors;
}

// The same schema with each `type: [x, 'null']` written as `type: x, nullable: true`
function withSingleTypes(schema: JsonSchema): JsonSchema {
  const copy: JsonSchema = { ...schema };
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((type) => type !== 'null');
    copy.type = types[0];
    if (types.length < schema.type.length) copy.nullable = true;
  }
  if (schema.items) copy.items = withSingleTypes(schema.items);
  if (schema.properties) {
    copy.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, child]) => [name, withSingleTypes(child)])
    );
  }
  return copy;
}

const string = (description?: string): JsonSchema => ({ type: 'string', ...(description && { description }) });
const integer: JsonSchema = { type: 'integer' };
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: 'object',
  properties,
  required: Object.keys(properties)
});

// Objects in arrays in objects, with enums, numbers, booleans and a nullable value
const PLAN_TRIP_SCHEMA = object({
  traveller: object({
    name: string(),
    age: integer,
    member: { type: 'boolean' },
    nickname: { type: ['string', 'null'], description: 'null when the traveller has no nickname' }
  }),
  legs: {
    type: 'array',
    items: object({
      from: string(),
      to: string(),
      mode: { type: 'string', enum: ['train', 'plane', 'bus'] },
      stops: { type: 'array', items: object({ city: string(), nights: integer }) },
      budget: { type: 'number', description: 'In euros' }
    })
  },
  preferences: object({
    window_seat: { type: 'boolean' },
    meal: { type: 'string', enum: ['standard', 'vegetarian', 'vegan'] },
    loyalty: object({ program: string(), tier: { type: 'string', enum: ['silver', 'gold', 'platinum'] } })
  })
});

const BOOK_HOTEL_SCHEMA = object({
  guest: object({ name: string(), adults: integer, children: { type: 'array', items: object({ age: integer }) } }),
  stay: object({
    city: string(),
    check_in: string('ISO date'),
    nights: integer,
    extras: { type: 'array', items: { type: 'string', enum: ['breakfast', 'parking', 'spa', 'late_checkout'] } }
  })
});

const RENT_CAR_SCHEMA = object({
  driver: object({ name: string(), age: integer }),
  pickup: object({ city: string(), date: string('ISO date') }),
  options: object({
    gps: { type: 'boolean' },
    child_seats: integer,
    insurance: { type: 'string', enum: ['basic', 'full'] }
  })
});

// The schema of the structured-output model entries in the manifest
const PROCESS_GRAPH_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'directed', 'nodes', 'edges'],
  properties: {
    title: { type: 'string' },
    directed: { type: 'boolean' },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'kind', 'weight', 'tags'],
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: ['start', 'step', 'decision', 'end'] },
          weight: { type: 'number' },
          tags: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'to', 'label'],
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          label: { anyOf: [{ type: 'string' }, { type: 'null' }] }
        }
      }
    }
  }
};

// A tool whose handler records the arguments it received
function recordingTool(
  name: string,
  description: string,
  schema: JsonSchema,
  output: (args: Record<string, unknown>) => string
) {
  const received: Array<Record<string, unknown>> = [];
  const tool: Chat.AdditionalTool = {
    definition: {
      name,
      description,
      inputSchema: {
        type: Chat.AdditionalToolSchemaType.OBJECT,
        properties: schema.properties,
        required: schema.required
      }
    },
    async handler(args) {
      received.push(args);
      return { content: [{ type: Chat.AdditionalToolContentType.TEXT, text: output(args) }] };
    }
  };
  return { tool, received };
}

// About 5 KB of nested JSON; the marker must never reach an event other than the model's own text
const TOOL_OUTPUT_MARKER = 'itinerary-internal-ref-q81z';
function itineraryOutput(): string {
  const segments = Array.from({ length: 22 }, (_, index) => ({
    index,
    carrier: { code: `C${index}`, name: `Carrier ${index}`, alliance: index % 2 ? 'Star' : null },
    seats: [{ row: 10 + index, letter: 'A', window: true }],
    fares: { base: 40 + index, taxes: [{ code: 'YQ', amount: 3.5 }], refundable: index % 3 === 0 },
    ref: TOOL_OUTPUT_MARKER
  }));
  return JSON.stringify({ status: 'planned', segments });
}

const PROMPTS = {
  short: 'Without using any tool, reply with exactly these two words and nothing else: Ready now',
  medium:
    'Without using any tool, write about 220 words on the history of the bicycle, as plain prose in two paragraphs.',
  long:
    'Without using any tool, write a detailed essay of at least 1,300 words on the history of lighthouses, in plain ' +
    'prose with many paragraphs. Do not stop before 1,300 words.',
  image: 'Describe the shape and colour in this picture in one sentence. Do not use any tool.',
  imageFollowUp: 'Which colour was the shape in my picture? Answer with one word. Do not use any tool.',
  diagram:
    'Without using any tool, show how to make a cup of tea in two forms. First a Mermaid flowchart that starts with ' +
    '"flowchart TD", inside a ```mermaid code fence. Then the same process as an ASCII-art graph of boxes and arrows ' +
    'spanning several lines, inside a ```text code fence. End with one short sentence after the fences.',
  multilingual:
    'Without using any tool, write: (1) a Markdown table with columns Language and Greeting, and rows for Ukrainian, ' +
    'Japanese and Arabic, each greeting in its own script; (2) a ```ts code block that logs the three greetings; ' +
    '(3) one line with exactly these emoji: 👩‍💻 👨‍👩‍👧‍👦 🏳️‍🌈 🇺🇦; (4) one sentence in Arabic.',
  planTrip:
    'Call plan_trip once with: traveller Olena, age 34, a loyalty member, no nickname (null). Legs: Kyiv to Warsaw by ' +
    'train with a stop in Lviv for 2 nights, budget 120.5; Warsaw to Berlin by plane with no stops, budget 89. ' +
    'Preferences: window seat yes, vegetarian meal, loyalty programme MilesPlus at gold tier. Then confirm in one sentence.',
  structured:
    'Describe how to make a cup of tea as a directed graph of 4 to 6 nodes, including one decision. Label the edges ' +
    'that leave the decision and give every other edge a null label.',
  parallel:
    'For my trip to Lisbon do both at once, in one step: book a hotel with book_hotel (guest Olena Shevchenko, 2 adults, ' +
    'children aged 4 and 7, check-in 2026-11-12 for 3 nights, extras breakfast and parking) and rent a car with ' +
    'rent_car (driver Olena Shevchenko, age 34, pickup in Lisbon on 2026-11-12, GPS yes, 2 child seats, full ' +
    'insurance). Then confirm in one sentence.',
  longAfterTool:
    'Use get_city_facts to look up the city Velmora. Then, using those facts, write a travel guide of at least 1,000 ' +
    'words about Velmora in plain prose with many paragraphs. Do not ask any questions.'
};

// The delta minimums suit the coarsest provider: Gemini sends about 20 to 25 tokens per chunk, OpenAI about one
const SIZES = [
  { name: 'short', prompt: PROMPTS.short, minDeltas: 1, outputTokens: [1, 20] },
  { name: 'medium', prompt: PROMPTS.medium, minDeltas: 5, outputTokens: [150, 700] },
  { name: 'long', prompt: PROMPTS.long, minDeltas: 30, outputTokens: [901, 1600] }
] as const;

for (const provider of PROVIDERS) {
  // Live: needs the provider's key (Gemini: the Vertex project and Application Default Credentials for it)
  describe.runIf(hasKeys(provider.key))(`Loft streaming content with ${provider.label} (live)`, () => {
    let testDb: TestDatabaseInstance;

    beforeAll(async () => {
      testDb = await initDB();
    }, 60000);

    afterAll(async () => {
      await testDb?.close();
    });

    beforeEach(async () => {
      await testDb.truncateAll();
    });

    async function setup(llmName = provider.llmName) {
      const chatConstructor = createChatConstructor(testDb);
      const loftConstructor = createLoftConstructor(chatConstructor);
      await provider.register(loftConstructor, llmName, { streamIdleTimeoutMs: IDLE_TIMEOUT_MS });
      const loft = loftConstructor.getInstance();
      const session = await loft.chat.createSession({
        currentLlmName: llmName,
        currentManifestName: 'test-bot',
        ctx: {}
      });

      const ask = (
        content: string | Type.Entity.FullContentPart[],
        generateOptions: Omit<Chat.GenerateOptions, 'sessionId' | 'directMessages' | 'onEvent'> = {},
        events?: StreamEvent[]
      ) =>
        measure(
          (onEvent) =>
            loft.chat.generate({
              sessionId: session.id,
              directMessages: [
                userMessage(
                  typeof content === 'string' ? [{ type: 'text', text: content }] : content,
                  session.id,
                  llmName
                )
              ],
              onEvent,
              ...generateOptions
            }),
          events
        );
      const history = async () => [...(await loft.chat.getChatHistory(session.id))];
      const savedReply = async () =>
        (await history()).filter((message) => message.role === Type.LLM.UnifiedMessageRole.assistant).at(-1);
      return { ask, history, savedReply };
    }

    const toolSchema = (schema: JsonSchema) => (provider.singleTypeToolSchemas ? withSingleTypes(schema) : schema);

    for (const size of SIZES) {
      it(`a ${size.name} reply streams in order, ends with one finish equal to the deltas and the saved reply`, async () => {
        const { ask, savedReply } = await setup();
        const measured = await ask(size.prompt);
        await measured.result.messages.save();
        report(provider, `size ${size.name}`, measured);

        expectStreamedAnswer(measured);
        expect(measured.events[0]).toMatchObject({ type: 'start', textPolicy: 'all', streaming: true });
        expect(ofType(measured.events, 'step-finish').map((event) => event.streamed)).toEqual([true]);
        expect(measured.finalDeltas.length).toBeGreaterThanOrEqual(size.minDeltas);
        const [min, max] = size.outputTokens;
        expect(measured.finish.usage.outputTokens).toBeGreaterThanOrEqual(min);
        expect(measured.finish.usage.outputTokens).toBeLessThanOrEqual(max);
        expect(textOf(await savedReply())).toBe(measured.finish.text);
      }, 180000);
    }

    it('a model entry capped at 64 output tokens stops at the cap', async () => {
      const { ask } = await setup(provider.cappedLlmName);
      const measured = await ask(PROMPTS.medium);
      report(provider, 'capped at 64', measured);

      expectStreamedAnswer(measured);
      expect(measured.finish.usage.outputTokens).toBeLessThanOrEqual(64);
      expect(measured.finish.finishReason).toMatch(/^(length|max_tokens|MAX_TOKENS)$/);
    }, 60000);

    it('an image in the prompt: the answer streams, the image is saved in the history and the next turn sees it', async () => {
      await retryOnce(provider, 'image', async () => {
        const { ask, history, savedReply } = await setup();
        const png = redDiscPng();
        const first = await ask([
          { type: 'text', text: PROMPTS.image },
          { type: 'image', format: Schema.Entity.ImageFormat.BASE64, data: png, mimeType: 'image/png' }
        ]);
        await first.result.messages.save();
        report(provider, 'image turn 1', first, `png=${Math.round((png.length * 3) / 4)}B`);

        expectStreamedAnswer(first);
        expect(first.finalDeltas.length).toBeGreaterThan(1);
        expect(first.finish.text).toMatch(/red/i);
        expect(first.finish.text).toMatch(/circle|circular|round|disc|disk|dot|ball|sphere/i);
        expect(textOf(await savedReply())).toBe(first.finish.text);
        const [savedUser] = await history();
        expect(savedUser.content).toContainEqual(
          expect.objectContaining({ type: 'image', format: Schema.Entity.ImageFormat.BASE64, data: png })
        );

        const second = await ask(PROMPTS.imageFollowUp);
        await second.result.messages.save();
        report(provider, 'image turn 2', second);
        expectStreamedAnswer(second);
        expect(second.finish.text).toMatch(/red/i);
        expect(await history()).toHaveLength(4);
      });
    }, 180000);

    it('a mermaid flowchart and an ASCII-art graph keep their fences and newlines through streaming', async () => {
      await retryOnce(provider, 'diagram', async () => {
        const { ask, savedReply } = await setup();
        const measured = await ask(PROMPTS.diagram);
        await measured.result.messages.save();
        const text = measured.finish.text;
        const fences = text.match(/^\s*```/gm) ?? [];
        const deltasWithNewline = measured.finalDeltas.filter((delta) => delta.includes('\n')).length;
        report(provider, 'diagram', measured, `fences=${fences.length} deltasWithNewline=${deltasWithNewline}`);

        expectStreamedAnswer(measured);
        expect(textOf(await savedReply())).toBe(text);
        expect(fences.length % 2).toBe(0);
        const mermaid = /```mermaid[^\n]*\n([\s\S]*?)\n\s*```/.exec(text)?.[1];
        expect(mermaid?.trimStart()).toMatch(/^(flowchart|graph)\b/);
        expect(mermaid?.split('\n').length).toBeGreaterThanOrEqual(3);
        const ascii = /```(?:text|txt|plaintext|ascii)?[^\n]*\n([\s\S]*?)\n\s*```/g;
        const blocks = [...text.matchAll(ascii)].map((match) => match[1]);
        expect(blocks.some((block) => !/^\s*(flowchart|graph)\b/.test(block) && block.split('\n').length >= 3)).toBe(
          true
        );
      });
    }, 120000);

    it('a table, a code block, four scripts and ZWJ emoji arrive with no replacement character and no split surrogate pair', async () => {
      await retryOnce(provider, 'multilingual', async () => {
        const { ask, savedReply } = await setup();
        const measured = await ask(PROMPTS.multilingual);
        await measured.result.messages.save();
        const text = measured.finish.text;
        const allDeltas = ofType(measured.events, 'text-delta').map((event) => event.delta);
        report(
          provider,
          'multilingual',
          measured,
          `deltaSplitsInsideGraphemes=${deltaBoundariesInsideGraphemes(measured.finalDeltas)}`
        );

        expectStreamedAnswer(measured);
        expect(textOf(await savedReply())).toBe(text);
        expect(allDeltas.filter((delta) => !isWellFormedText(delta))).toEqual([]);
        expect(allDeltas.filter((delta) => delta.includes('�'))).toEqual([]);
        expect(isWellFormedText(text)).toBe(true);
        expect(text).not.toContain('�');
        expect(text).toMatch(/^\s*\|.*\|\s*$/m);
        expect(text).toMatch(/```(ts|typescript)/);
        expect(text).toMatch(/[Ѐ-ӿ]/);
        expect(text).toMatch(/[぀-ヿ一-鿿]/);
        expect(text).toMatch(/[؀-ۿ]/);
        expect(text).toContain('‍');
        expect(text).toContain('🇺🇦');
      });
    }, 120000);

    it('a tool with deeply nested arguments: tool-call args equal what the handler got, valid against the schema, and the 5 KB output is never an event', async () => {
      await retryOnce(provider, 'nested tool args', async () => {
        const { ask, history } = await setup();
        const output = itineraryOutput();
        expect(output.length).toBeGreaterThan(4000);
        expect(output.length).toBeLessThan(7000);
        const { tool, received } = recordingTool(
          'plan_trip',
          'Plans a multi-leg trip for one traveller',
          toolSchema(PLAN_TRIP_SCHEMA),
          () => output
        );

        const measured = await ask(PROMPTS.planTrip, {
          additionalTools: [tool],
          streamOptions: { include: { toolCalls: 'args' } }
        });
        await measured.result.messages.save();
        report(provider, 'nested tool args', measured, `toolOutput=${output.length}B`);

        expectStreamedAnswer(measured);
        const calls = ofType(measured.events, 'tool-call');
        expect(calls.map((event) => [event.step, event.name])).toEqual([[0, 'plan_trip']]);
        expect(received).toHaveLength(1);
        expect(calls[0].args).toEqual(received[0]);
        expect(calls[0].args).not.toBe(received[0]);
        expect(schemaErrors(PLAN_TRIP_SCHEMA, calls[0].args)).toEqual([]);
        expect(calls[0].args).toMatchObject({
          traveller: { age: 34, member: true },
          legs: [
            { mode: 'train', stops: [{ nights: 2 }] },
            { mode: 'plane', stops: [] }
          ],
          preferences: { window_seat: true, meal: 'vegetarian', loyalty: { tier: 'gold' } }
        });
        expect(ofType(measured.events, 'tool-result')).toEqual([
          expect.objectContaining({ step: 0, name: 'plan_trip', status: 'succeeded' })
        ]);
        const notText = measured.events.filter((event) => event.type !== 'text-delta' && event.type !== 'finish');
        expect(JSON.stringify(notText)).not.toContain(TOOL_OUTPUT_MARKER);
        // The model received the output, and the history keeps it
        expect(JSON.stringify(await history())).toContain(TOOL_OUTPUT_MARKER);
      });
    }, 120000);

    // Gemini runs the other tool scenarios with OpenAPI-style nullable values; this one declares a JSON Schema type list
    it.runIf(provider.singleTypeToolSchemas)(
      'a tool whose nullable parameter is declared as a JSON Schema type list runs',
      async () => {
        const { ask } = await setup();
        const { tool, received } = recordingTool(
          'plan_trip',
          'Plans a multi-leg trip for one traveller',
          PLAN_TRIP_SCHEMA,
          itineraryOutput
        );
        const events: StreamEvent[] = [];
        const measured = await ask(
          PROMPTS.planTrip,
          { additionalTools: [tool], streamOptions: { include: { toolCalls: 'args' } } },
          events
        ).catch((error: unknown) => {
          const name = error instanceof Error ? error.name : 'unknown';
          console.info(`[content] ${provider.label} | nullable type list | rejected: ${name} | ${sequenceOf(events)}`);
          throw error;
        });
        report(provider, 'nullable type list', measured);
        expect(received).toHaveLength(1);
      },
      60000
    );

    it.runIf(provider.structuredLlmName !== undefined)(
      'structured output with a nested JSON schema: finish.text parses and matches the schema',
      async () => {
        await retryOnce(provider, 'structured output', async () => {
          const { ask } = await setup(provider.structuredLlmName);
          const measured = await ask(PROMPTS.structured);
          report(provider, 'structured output', measured);

          expectStreamedAnswer(measured);
          expect(ofType(measured.events, 'step-finish').map((event) => event.streamed)).toEqual([
            provider.structuredStreams
          ]);
          if (provider.structuredStreams) expect(measured.finalDeltas.length).toBeGreaterThan(1);
          else expect(measured.finalDeltas).toHaveLength(1);
          const parsed: unknown = JSON.parse(measured.finish.text);
          expect(schemaErrors(PROCESS_GRAPH_SCHEMA, parsed)).toEqual([]);
          const graph = parsed as { nodes: Array<{ kind: string }> };
          expect(graph.nodes.length).toBeGreaterThanOrEqual(3);
        });
      },
      120000
    );

    it('two tools in parallel, each with nested args: both calls in step 0 carry the args their handlers got', async () => {
      await retryOnce(provider, 'parallel nested tools', async () => {
        const { ask } = await setup();
        const hotel = recordingTool(
          'book_hotel',
          'Books a hotel stay',
          toolSchema(BOOK_HOTEL_SCHEMA),
          () => '{"booking":"H-1","status":"confirmed"}'
        );
        const car = recordingTool(
          'rent_car',
          'Rents a car',
          toolSchema(RENT_CAR_SCHEMA),
          () => '{"booking":"C-1","status":"confirmed"}'
        );

        const measured = await ask(PROMPTS.parallel, {
          additionalTools: [hotel.tool, car.tool],
          streamOptions: { include: { toolCalls: 'args' } }
        });
        await measured.result.messages.save();
        report(provider, 'parallel nested tools', measured);

        expectStreamedAnswer(measured);
        const calls = ofType(measured.events, 'tool-call');
        expect(calls.map((event) => event.step)).toEqual([0, 0]);
        expect(calls.map((event) => event.name).sort()).toEqual(['book_hotel', 'rent_car']);
        expect(new Set(calls.map((event) => event.toolCallId)).size).toBe(2);
        for (const [name, recorded, schema] of [
          ['book_hotel', hotel.received, BOOK_HOTEL_SCHEMA],
          ['rent_car', car.received, RENT_CAR_SCHEMA]
        ] as const) {
          const call = calls.find((event) => event.name === name);
          expect(recorded).toHaveLength(1);
          expect(call?.args).toEqual(recorded[0]);
          expect(schemaErrors(schema, call?.args)).toEqual([]);
        }
        expect(calls.find((event) => event.name === 'book_hotel')?.args).toMatchObject({
          guest: { adults: 2, children: [{ age: 4 }, { age: 7 }] },
          stay: { nights: 3 }
        });
        expect(calls.find((event) => event.name === 'rent_car')?.args).toMatchObject({
          options: { gps: true, child_seats: 2, insurance: 'full' }
        });
        const results = ofType(measured.events, 'tool-result');
        expect(results.map((event) => [event.step, event.status])).toEqual([
          [0, 'succeeded'],
          [0, 'succeeded']
        ]);
      });
    }, 120000);

    it('a tool round then a long final answer of at least 800 tokens: two steps, the second streams the answer', async () => {
      await retryOnce(provider, 'long after tool', async () => {
        const { ask, savedReply } = await setup();
        const { tool, received } = recordingTool(
          'get_city_facts',
          'Returns facts about a city',
          object({ city: string('The city name') }),
          () =>
            JSON.stringify({
              city: 'Velmora',
              country: 'a small coastal republic',
              founded: 1312,
              population: 84000,
              famous_for: ['a glass lighthouse', 'salt-cured olives', 'a winter lantern festival'],
              districts: ['Old Harbour', 'Lantern Hill', 'the Salt Flats']
            })
        );

        const measured = await ask(PROMPTS.longAfterTool, {
          additionalTools: [tool],
          streamOptions: { include: { toolCalls: 'names' } }
        });
        await measured.result.messages.save();
        const steps = ofType(measured.events, 'step-finish');
        const lastStepOutput = steps.at(-1)?.usage?.outputTokens ?? 0;
        report(provider, 'long after tool', measured, `lastStepOut=${lastStepOutput}`);

        expectStreamedAnswer(measured);
        expect(received).toEqual([{ city: expect.stringMatching(/velmora/i) }]);
        expect(steps).toHaveLength(2);
        expect(steps.map((event) => event.hadToolCalls)).toEqual([true, false]);
        expect(steps[1].streamed).toBe(true);
        expect(ofType(measured.events, 'tool-call')).toEqual([
          expect.not.objectContaining({ args: expect.anything() })
        ]);
        expect(measured.finalDeltas.length).toBeGreaterThan(20);
        expect(lastStepOutput).toBeGreaterThanOrEqual(800);
        expect(textOf(await savedReply())).toBe(measured.finish.text);
      });
    }, 180000);
  });
}
