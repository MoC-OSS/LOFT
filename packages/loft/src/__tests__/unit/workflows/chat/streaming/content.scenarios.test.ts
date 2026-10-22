import 'reflect-metadata';

import {
  Chat,
  ContextInterface,
  createBeforeGenerateMiddlewareManager,
  createStandardMiddlewareManager,
  DI_TYPES,
  GenerateRequestParameters,
  Interface,
  Repository,
  Strategy,
  Type
} from '@moc-global/loft-definitions';
import { configureSpyLoggerStrategy, ScriptedLLMStrategy, ScriptedReply } from '@moc-global/loft-test-suite';
import { Container } from 'inversify';
import { describe, expect, it, vi } from 'vitest';

import { NoOpTracerStrategy } from '../../../../../base-components';
import { FocusRegistry } from '../../../../../focus/FocusRegistry';
import { LoftHealthCheckInterface } from '../../../../../LoftHealthCheck';
import { LlmManager } from '../../../../../managers/LlmManager';
import { ToolInterceptorManager } from '../../../../../managers/ToolInterceptorManager';
import { ContextProvider } from '../../../../../providers/ContextProvider';
import { GenerateResultMessagesProvider } from '../../../../../providers/GenerateResultMessagesProvider';
import { ChatConfig } from '../../../../../types';
import { BaseLoftChat } from '../../../../../workflows/chat/BaseLoftChat';

// Streamed content of different sizes and shapes: very long replies in many pieces, pieces that split a character,
// text that looks like a transport frame, deeply nested tool arguments, and a very large tool output. Each scenario
// runs chat.generate() with onEvent against the scripted model.

configureSpyLoggerStrategy();

const LLM = 'scripted';
const MANIFEST = 'assistant';
const SESSION_ID = '00000000-0000-4000-8000-000000000003';

type ChatEvent = Chat.ChatStreamEvent;
type EventOf<T extends ChatEvent['type']> = Extract<ChatEvent, { type: T }>;

function ofType<T extends ChatEvent['type']>(events: ChatEvent[], type: T): EventOf<T>[] {
  return events.filter((event): event is EventOf<T> => event.type === type);
}

const TERMINAL_TYPES = new Set<ChatEvent['type']>(['finish', 'error', 'abort']);

// seq 0..n with no gaps, start first, one terminal event and it is the last
function expectWellFormed(events: ChatEvent[]): void {
  expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
  expect(events[0]?.type).toBe('start');
  expect(events.filter((event) => TERMINAL_TYPES.has(event.type))).toHaveLength(1);
  expect(TERMINAL_TYPES.has(events.at(-1)?.type ?? 'start')).toBe(true);
}

// A string without a high surrogate missing its low half, or a low surrogate without its high half
function isWellFormedText(text: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
}

// A seeded PRNG, so a failing split can be reproduced
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Splits the text at `count - 1` distinct random code-unit positions, so every piece has at least one code unit
function randomChunks(text: string, count: number, random: () => number): string[] {
  const cuts = new Set<number>();
  while (cuts.size < count - 1) cuts.add(1 + Math.floor(random() * (text.length - 1)));
  const sorted = [...cuts].sort((a, b) => a - b);
  return [0, ...sorted].map((start, index) => text.slice(start, sorted[index] ?? text.length));
}

const userMessage = (text: string): Type.Entity.CreateMessage => ({
  sessionId: SESSION_ID,
  ctx: {},
  content: [{ type: 'text', text }],
  role: Type.LLM.UnifiedMessageRole.user,
  author: 'user',
  llmName: LLM,
  manifestName: MANIFEST,
  llmIgnore: false
});

function textOfMessage(message: Type.Entity.CreateMessage | undefined): string {
  return (message?.content ?? []).map((part) => (part.type === 'text' ? part.text : '')).join('');
}

class SessionRepository implements Repository.Session {
  readonly session: Type.Entity.Session = {
    id: SESSION_ID,
    ctx: {},
    currentLlmName: LLM,
    currentManifestName: MANIFEST,
    externalKey: { userId: 'user-1' },
    focusAgent: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z')
  };

  create = vi.fn();
  getByExternalKey = vi.fn();
  updateById = vi.fn(async () => this.session);
  deleteById = vi.fn();
  checkHealth = vi.fn();
  end = vi.fn();

  async getById(): Promise<Type.Entity.Session> {
    return this.session;
  }
}

// Keeps what save() stores
class ChatHistoryManager implements Repository.ChatHistoryManager {
  readonly saved: Type.Entity.CreateMessage[] = [];
  private nextId = 0;

  getMessages = vi.fn(async (): Promise<Type.Entity.Message[]> => []);
  patchMessages = vi.fn();
  checkHealth = vi.fn();
  end = vi.fn();

  addMessages = vi.fn(async (_sessionId: string, messages: Type.Entity.CreateMessage[]) => {
    this.saved.push(...messages);
    return messages.map((message): Type.Entity.Message => ({
      ...message,
      id: `message-${++this.nextId}`,
      sequenceId: String(this.nextId),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z')
    }));
  });
}

// A chat with the scripted model and no output middleware, so the text policy defaults to 'all'
async function createChat(replies: ScriptedReply[]) {
  const llm = new ScriptedLLMStrategy(LLM, replies);
  const sessionRepository = new SessionRepository();
  const chatHistoryManager = new ChatHistoryManager();
  const config: ChatConfig = { mcp: { maxCallsPerGenerate: 5 } };

  const manifestManager = {
    useLlmManifestSchema: vi.fn().mockResolvedValue(undefined),
    getLlmManifest: vi.fn().mockResolvedValue({ systemMessage: 'You help.', modelPreset: { model: 'scripted' } })
  } as unknown as Interface.ManifestManager;
  const computerManager = {
    compute: vi.fn().mockResolvedValue('You help.')
  } as unknown as Interface.ComputerManager<ContextInterface>;
  const mcpManager = {
    listTools: vi.fn().mockResolvedValue([]),
    callTool: vi.fn(),
    getClientsInfoForTool: vi.fn().mockResolvedValue(new Map())
  } as unknown as Interface.MCP.MCPManager;
  const cropper = {
    crop: (messages: Type.Entity.Message[]) => messages
  } as unknown as Strategy.LlmContextWindowCropper;

  const llmManager = new LlmManager(
    manifestManager,
    computerManager,
    computerManager,
    computerManager,
    mcpManager,
    cropper,
    new ToolInterceptorManager(),
    config
  );
  await llmManager.use(LLM, llm, false);

  const container = new Container();
  container.bind<Repository.Session>(DI_TYPES.SessionRepository).toConstantValue(sessionRepository);
  container.bind<Repository.ChatHistoryManager>(DI_TYPES.ChatHistoryManager).toConstantValue(chatHistoryManager);
  container.bind<Interface.LlmManager>(DI_TYPES.LlmManager).toConstantValue(llmManager);
  container.bind(DI_TYPES.TracerStrategy).toConstantValue(new NoOpTracerStrategy());
  const healthCheck: LoftHealthCheckInterface = { check: vi.fn() };

  const chat = new BaseLoftChat(
    sessionRepository,
    chatHistoryManager,
    new ContextProvider(container, config),
    llmManager,
    config,
    healthCheck,
    createStandardMiddlewareManager<ContextInterface, GenerateRequestParameters>('input'),
    createBeforeGenerateMiddlewareManager<ContextInterface, GenerateRequestParameters>('beforeGenerate'),
    createStandardMiddlewareManager<ContextInterface, Chat.GenerateResultMessages>('afterGenerate'),
    new GenerateResultMessagesProvider(chatHistoryManager),
    new FocusRegistry()
  );

  return { chat, llm, chatHistoryManager };
}

interface RunOptions {
  additionalTools?: Chat.AdditionalTool[];
  streamOptions?: Chat.StreamOptions;
  onEvent?: (event: ChatEvent) => void;
}

async function run(replies: ScriptedReply[], options: RunOptions = {}) {
  const { chat, llm, chatHistoryManager } = await createChat(replies);
  const events: ChatEvent[] = [];
  const result = await chat.generate({
    sessionId: SESSION_ID,
    directMessages: [userMessage('Go')],
    additionalTools: options.additionalTools,
    streamOptions: options.streamOptions,
    onEvent: (event) => {
      events.push(event);
      options.onEvent?.(event);
    }
  });
  await result.messages.save();
  const savedReply = chatHistoryManager.saved
    .filter((message) => message.role === Type.LLM.UnifiedMessageRole.assistant)
    .at(-1);
  return { events, result, llm, saved: chatHistoryManager.saved, savedReply };
}

// The text-deltas of the last step, which hold the final answer
function finalDeltas(events: ChatEvent[]): string[] {
  const lastStep = ofType(events, 'step-finish').at(-1)?.step;
  return ofType(events, 'text-delta')
    .filter((event) => event.step === lastStep)
    .map((event) => event.delta);
}

describe('Streamed content of different sizes and shapes (scripted model)', () => {
  it('a 20,000-character reply in 2,000 random-size pieces arrives as 2,000 deltas in order and is saved whole', async () => {
    const random = mulberry32(20261022);
    const alphabet = 'abcdefghijklmnopqrstuvwxyz     .,\n';
    const text = Array.from({ length: 20000 }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
    const chunks = randomChunks(text, 2000, random);
    expect(chunks.join('')).toBe(text);

    const startedAt = performance.now();
    const { events, savedReply } = await run([{ text, chunks }]);
    const elapsedMs = performance.now() - startedAt;

    expectWellFormed(events);
    const deltas = ofType(events, 'text-delta');
    expect(deltas).toHaveLength(2000);
    expect(deltas.map((event) => event.delta)).toEqual(chunks);
    const [finish] = ofType(events, 'finish');
    expect(finish).toMatchObject({ text, textReplaced: false, finishReason: 'stop' });
    expect(ofType(events, 'step-finish').map((event) => event.streamed)).toEqual([true]);
    expect(textOfMessage(savedReply)).toBe(text);
    // 2,000 events are handled well within a second on any CI machine; the bound only catches a quadratic slowdown
    expect(elapsedMs).toBeLessThan(5000);
  });

  it('pieces that split emoji and flags between their surrogate halves are forwarded as received and join to the whole text', async () => {
    const text = 'Hi 👩‍💻 and 👨‍👩‍👧‍👦, flag 🇺🇦 🏳️‍🌈, kanji 𠮷野家 done';
    // Cut after every high surrogate, so each astral character arrives in two deltas
    const chunks: string[] = [];
    let piece = '';
    for (const unit of text.split('')) {
      piece += unit;
      if (/[\uD800-\uDBFF]/.test(unit)) {
        chunks.push(piece);
        piece = '';
      }
    }
    chunks.push(piece);
    expect(chunks.join('')).toBe(text);
    expect(chunks.some((chunk) => !isWellFormedText(chunk))).toBe(true);

    const { events, savedReply } = await run([{ text, chunks }]);

    expectWellFormed(events);
    const deltas = ofType(events, 'text-delta').map((event) => event.delta);
    // LOFT does not regroup the pieces: a delta may end in half a character when the provider split it so
    expect(deltas).toEqual(chunks);
    expect(deltas.filter((delta) => !isWellFormedText(delta)).length).toBeGreaterThan(0);
    const [finish] = ofType(events, 'finish');
    expect(finish.text).toBe(text);
    expect(isWellFormedText(finish.text)).toBe(true);
    expect(finish.text).not.toContain('�');
    expect(finish.textReplaced).toBe(false);
    expect(textOfMessage(savedReply)).toBe(text);
  });

  it('a reply that ends in half a surrogate pair is forwarded and saved as received, not repaired', async () => {
    const text = 'Broken tail \uD83D';
    const chunks = ['Broken ', 'tail ', '\uD83D'];

    const { events, savedReply } = await run([{ text, chunks }]);

    expectWellFormed(events);
    expect(ofType(events, 'text-delta').map((event) => event.delta)).toEqual(chunks);
    const [finish] = ofType(events, 'finish');
    expect(finish.text).toBe(text);
    expect(isWellFormedText(finish.text)).toBe(false);
    expect(textOfMessage(savedReply)).toBe(text);
    // JSON keeps the lone half as an escape, so a JSON transport does not corrupt it into U+FFFD
    expect(JSON.stringify(finish.text)).toContain('\\ud83d');
  });

  it('mermaid, a table and code with blank lines, frame-like lines, CRLF and U+2028/U+2029 survive splitting at every awkward spot', async () => {
    const text = [
      '```mermaid',
      'flowchart TD',
      '  A[Boil water] --> B{Tea bag?}',
      '  B -->|yes| C[Steep]',
      '```',
      '',
      '',
      '| Step | Note |',
      '|---|---|',
      '| 1 | event: message |',
      '| 2 | data: {"x":1} |',
      '',
      '```ts',
      'const frame = "event: delta\\ndata: hi\\n\\n";',
      '```',
      'id: 7\r\nretry: 10\r\n\r\nline\u2028separator\u2029paragraph\ttab\u0000nul\u001bescape'
    ].join('\n');
    // Cut between the two newlines of every blank line, inside each "event:"/"data:" and around U+2028/U+2029
    const cutPoints = new Set<number>();
    for (const pattern of [/\n\n/g, /event:/g, /data:/g, /\r\n/g, /[\u2028\u2029]/g, /```/g]) {
      for (const match of text.matchAll(pattern)) {
        const index = match.index ?? 0;
        cutPoints.add(index + 1);
        if (index > 0) cutPoints.add(index);
      }
    }
    const sorted = [...cutPoints].filter((cut) => cut > 0 && cut < text.length).sort((a, b) => a - b);
    const chunks = [0, ...sorted].map((start, index) => text.slice(start, sorted[index] ?? text.length));
    expect(chunks.join('')).toBe(text);
    expect(chunks).toContain('\n');

    const { events, savedReply } = await run([{ text, chunks }]);

    expectWellFormed(events);
    const deltas = ofType(events, 'text-delta');
    expect(deltas.map((event) => event.delta)).toEqual(chunks);
    const [finish] = ofType(events, 'finish');
    expect(finish.text).toBe(text);
    expect(finish.text.match(/^```/gm)).toHaveLength(4);
    expect(textOfMessage(savedReply)).toBe(text);
    // Every event survives a JSON round trip unchanged, control characters included
    for (const event of events) expect(JSON.parse(JSON.stringify(event))).toEqual(event);
  });

  it('empty pieces from the provider are not sent as deltas, and the text still joins up', async () => {
    const text = 'abc';
    const chunks = ['', 'a', '', '', 'b', 'c', ''];

    const { events } = await run([{ text, chunks }]);

    expectWellFormed(events);
    expect(ofType(events, 'text-delta').map((event) => event.delta)).toEqual(['a', 'b', 'c']);
    expect(ofType(events, 'finish')[0].text).toBe(text);
  });

  describe('deeply nested tool arguments with toolCalls args', () => {
    // Objects in arrays in objects, ten levels deep at the end, with every JSON value type
    const nestedArgs = (): Record<string, unknown> => {
      let deep: Record<string, unknown> = { leaf: 'bottom', n: 0 };
      for (let level = 1; level <= 10; level += 1) deep = { level, child: deep, list: [deep] };
      return {
        traveller: { name: 'Олена 👩‍💻', age: 34, member: true, nickname: null },
        legs: [
          {
            from: 'Kyiv',
            to: 'Warsaw',
            mode: 'train',
            stops: [{ city: 'Lviv', nights: 2, tags: ['night', 'old town'] }],
            budget: 120.5
          },
          { from: 'Warsaw', to: 'Berlin', mode: 'plane', stops: [], budget: 89 }
        ],
        preferences: { window_seat: false, meal: 'vegetarian', loyalty: { program: 'MilesPlus', tier: 'gold' } },
        numbers: [0, -1, 1.5e300, Number.MAX_SAFE_INTEGER],
        text: 'quote " backslash \\ newline \n tab \t data: x\n\nevent: y \u2028',
        deep
      };
    };

    it('the tool-call event carries a deep copy: equal to what the handler gets, sharing no object with it', async () => {
      const args = nestedArgs();
      const received: Array<Record<string, unknown>> = [];
      const tool: Chat.AdditionalTool = {
        definition: {
          name: 'plan_trip',
          description: 'Plans a trip',
          inputSchema: { type: Chat.AdditionalToolSchemaType.OBJECT, properties: {} }
        },
        async handler(handlerArgs) {
          received.push(handlerArgs);
          return { content: [{ type: Chat.AdditionalToolContentType.TEXT, text: 'planned' }] };
        }
      };

      const { events } = await run(
        [{ toolCalls: [{ name: 'plan_trip', callId: 'call-1', arguments: args }] }, { text: 'Done', chunks: ['Done'] }],
        { additionalTools: [tool], streamOptions: { include: { toolCalls: 'args' } } }
      );

      expectWellFormed(events);
      const [call] = ofType(events, 'tool-call');
      expect(call).toMatchObject({ step: 0, toolCallId: 'call-1', name: 'plan_trip' });
      expect(received).toHaveLength(1);
      expect(call.args).toEqual(received[0]);
      expect(call.args).toEqual(nestedArgs());
      expect(call.args).not.toBe(received[0]);
      const eventArgs = call.args as { legs: unknown[]; deep: Record<string, unknown> };
      const handlerArgs = received[0] as { legs: unknown[]; deep: Record<string, unknown> };
      expect(eventArgs.legs).not.toBe(handlerArgs.legs);
      expect(eventArgs.legs[0]).not.toBe(handlerArgs.legs[0]);
      expect(eventArgs.deep).not.toBe(handlerArgs.deep);
    });

    it('a caller that changes the event args in onEvent does not change what the tool receives or what is saved', async () => {
      const received: Array<Record<string, unknown>> = [];
      const tool: Chat.AdditionalTool = {
        definition: {
          name: 'plan_trip',
          description: 'Plans a trip',
          inputSchema: { type: Chat.AdditionalToolSchemaType.OBJECT, properties: {} }
        },
        async handler(handlerArgs) {
          received.push(structuredClone(handlerArgs));
          return { content: [{ type: Chat.AdditionalToolContentType.TEXT, text: 'planned' }] };
        }
      };
      const vandalise = (event: ChatEvent): void => {
        if (event.type !== 'tool-call' || !event.args) return;
        const args = event.args as { legs: Array<{ stops: Array<{ nights: number }> }>; traveller: { name: string } };
        args.legs[0].stops[0].nights = 99;
        args.traveller.name = 'changed by the caller';
        args.legs.push({ stops: [] });
      };

      const { events, saved } = await run(
        [
          { toolCalls: [{ name: 'plan_trip', callId: 'call-1', arguments: nestedArgs() }] },
          { text: 'Done', chunks: ['Done'] }
        ],
        { additionalTools: [tool], streamOptions: { include: { toolCalls: 'args' } }, onEvent: vandalise }
      );

      expectWellFormed(events);
      expect(received).toEqual([nestedArgs()]);
      const savedCall = saved
        .flatMap((message) => message.content)
        .find((part): part is Extract<Type.Entity.FullContentPart, { type: 'tool_call' }> => part.type === 'tool_call');
      expect(savedCall?.params.arguments).toEqual(nestedArgs());
    });

    it('a tool that changes its own args does not change the tool-call event already sent', async () => {
      const tool: Chat.AdditionalTool = {
        definition: {
          name: 'plan_trip',
          description: 'Plans a trip',
          inputSchema: { type: Chat.AdditionalToolSchemaType.OBJECT, properties: {} }
        },
        async handler(handlerArgs) {
          (handlerArgs.preferences as { meal: string }).meal = 'changed by the tool';
          (handlerArgs.legs as unknown[]).length = 0;
          return { content: [{ type: Chat.AdditionalToolContentType.TEXT, text: 'planned' }] };
        }
      };

      const { events } = await run(
        [
          { toolCalls: [{ name: 'plan_trip', callId: 'call-1', arguments: nestedArgs() }] },
          { text: 'Done', chunks: ['Done'] }
        ],
        { additionalTools: [tool], streamOptions: { include: { toolCalls: 'args' } } }
      );

      expect(ofType(events, 'tool-call')[0].args).toEqual(nestedArgs());
    });

    it('two parallel calls with nested args each carry their own args, and names-only leaves the args out', async () => {
      const hotelArgs = {
        guest: { name: 'Olena', adults: 2, children: [{ age: 4 }, { age: 7 }] },
        stay: { city: 'Lisbon', check_in: '2026-11-12', nights: 3, extras: ['breakfast', 'parking'] }
      };
      const carArgs = {
        driver: { name: 'Olena', age: 34 },
        pickup: { city: 'Lisbon', date: '2026-11-12' },
        options: { gps: true, child_seats: 2, insurance: 'full' }
      };
      const tools = ['book_hotel', 'rent_car'].map((name): Chat.AdditionalTool => ({
        definition: {
          name,
          description: `The ${name} tool`,
          inputSchema: { type: Chat.AdditionalToolSchemaType.OBJECT, properties: {} }
        },
        async handler() {
          return { content: [{ type: Chat.AdditionalToolContentType.TEXT, text: `${name} done` }] };
        }
      }));
      const replies = (): ScriptedReply[] => [
        {
          toolCalls: [
            { name: 'book_hotel', callId: 'call-h', arguments: hotelArgs },
            { name: 'rent_car', callId: 'call-c', arguments: carArgs }
          ]
        },
        { text: 'Booked', chunks: ['Boo', 'ked'] }
      ];

      const withArgs = await run(replies(), {
        additionalTools: tools,
        streamOptions: { include: { toolCalls: 'args' } }
      });
      const withNames = await run(replies(), { additionalTools: tools });

      expectWellFormed(withArgs.events);
      expect(
        ofType(withArgs.events, 'tool-call').map(({ toolCallId, name, args }) => ({ toolCallId, name, args }))
      ).toEqual([
        { toolCallId: 'call-h', name: 'book_hotel', args: hotelArgs },
        { toolCallId: 'call-c', name: 'rent_car', args: carArgs }
      ]);
      expectWellFormed(withNames.events);
      for (const call of ofType(withNames.events, 'tool-call')) expect(call).not.toHaveProperty('args');
    });
  });

  it('a 1 MB tool output reaches the model and the history but never an event', async () => {
    const marker = 'tool-output-marker-7f3a';
    const output = `${marker}${'x'.repeat(1024 * 1024 - marker.length * 2)}${marker}`;
    expect(output).toHaveLength(1024 * 1024);
    const tool: Chat.AdditionalTool = {
      definition: {
        name: 'export_report',
        description: 'Exports a report',
        inputSchema: { type: Chat.AdditionalToolSchemaType.OBJECT, properties: {} }
      },
      async handler(_args, context) {
        context?.emit('progress', { percent: 100 });
        return { content: [{ type: Chat.AdditionalToolContentType.TEXT, text: output }] };
      }
    };

    const { events, llm, saved } = await run(
      [
        { toolCalls: [{ name: 'export_report', callId: 'call-1', arguments: { format: 'csv' } }] },
        { text: 'The report is ready.', chunks: ['The report', ' is ready.'] }
      ],
      { additionalTools: [tool], streamOptions: { include: { toolCalls: 'args' } } }
    );

    expectWellFormed(events);
    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain(marker);
    expect(serialised.length).toBeLessThan(10000);
    const [result] = ofType(events, 'tool-result');
    expect(Object.keys(result).sort()).toEqual(
      ['durationMs', 'name', 'runId', 'seq', 'status', 'step', 'toolCallId', 'type'].sort()
    );
    expect(result.status).toBe('succeeded');
    expect(ofType(events, 'data')).toEqual([expect.objectContaining({ name: 'progress', data: { percent: 100 } })]);

    // The model was sent the whole output, and the history keeps it
    expect(llm.calls[1].messages.flatMap((message) => message.toolResults).map((result) => result.text)).toEqual([
      output
    ]);
    const savedOutput = saved
      .flatMap((message) => message.content)
      .find(
        (part): part is Extract<Type.Entity.FullContentPart, { type: 'tool_result' }> => part.type === 'tool_result'
      );
    expect(JSON.stringify(savedOutput)).toContain(output);
    expect(finalDeltas(events).join('')).toBe(ofType(events, 'finish')[0].text);
  });
});
