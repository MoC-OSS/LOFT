import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { Chat, GenerateError, Type } from '@moc-global/loft-definitions';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initAnthropicStrategy } from './AnthropicStrategyWithCallManager';
import { hasKeys } from './config';
import { initDB, type TestDatabaseInstance } from './initDB';
import { createChatConstructor, createLoftConstructor } from './loftInit';
import { InitClientServer } from './mcpClientServerInMemory';

// Claude Haiku 5.5 with 500 output tokens and a system message that asks for tools only when they are needed
const LLM_NAME = 'claude-haiku-tool-calls';

const userMessage = (text: string, sessionId: string): Type.Entity.Message => ({
  id: randomUUID(),
  sequenceId: '1',
  sessionId,
  ctx: {},
  llmName: '',
  manifestName: '',
  content: [{ type: 'text', text }],
  role: Type.LLM.UnifiedMessageRole.user,
  author: 'user',
  llmIgnore: false,
  createdAt: new Date(),
  updatedAt: new Date()
});

function ofType<T extends Chat.ChatStreamEvent['type']>(events: Chat.ChatStreamEvent[], type: T) {
  return events.filter((event): event is Extract<Chat.ChatStreamEvent, { type: T }> => event.type === type);
}

const TERMINAL = new Set(['finish', 'error', 'abort']);

// Every call numbers its events 0, 1, 2… and ends with exactly one terminal event
function expectWellFormed(events: Chat.ChatStreamEvent[]) {
  expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
  expect(events.filter((event) => TERMINAL.has(event.type))).toHaveLength(1);
  expect(TERMINAL.has(events.at(-1)?.type ?? '')).toBe(true);
}

const textOf = (message: Type.Entity.Message | undefined) =>
  (message?.content ?? []).map((part) => (part.type === 'text' ? part.text : '')).join('');

// Live: needs LOFT_ANTHROPIC_API_KEY
describe.runIf(hasKeys('LOFT_ANTHROPIC_API_KEY'))('Loft streaming with Anthropic (live)', () => {
  let testDb: TestDatabaseInstance;

  beforeAll(async () => {
    testDb = await initDB();
  }, 30000);

  afterAll(async () => {
    await testDb?.close();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
  });

  async function setup(withCalculator = false) {
    const chatConstructor = createChatConstructor(testDb);
    const loftConstructor = createLoftConstructor(chatConstructor);
    const loft = loftConstructor.getInstance();
    await loftConstructor.registerLlmStrategy(LLM_NAME, initAnthropicStrategy(LLM_NAME));
    if (withCalculator) chatConstructor.useMcpClient('calculator', await InitClientServer());
    const session = await loft.chat.createSession({
      currentLlmName: LLM_NAME,
      currentManifestName: 'test-bot',
      ctx: {}
    });
    return { loft, session };
  }

  it('plain answer streams several text-deltas; finish.text equals the saved reply; usage is non-zero', async () => {
    const { loft, session } = await setup();
    const events: Chat.ChatStreamEvent[] = [];

    const result = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [
        userMessage(
          'Without calling any tool, explain in five sentences what an abacus is and how people used it.',
          session.id
        )
      ],
      onEvent: (event) => events.push(event)
    });
    await result.messages.save();

    expectWellFormed(events);
    const deltas = ofType(events, 'text-delta');
    expect(deltas.length).toBeGreaterThan(1);
    const [finish] = ofType(events, 'finish');
    expect(finish?.text).toBe(deltas.map((event) => event.delta).join(''));
    expect(ofType(events, 'step-finish').at(-1)?.streamed).toBe(true);
    expect(finish?.usage.inputTokens).toBeGreaterThan(0);
    expect(finish?.usage.outputTokens).toBeGreaterThan(0);
    // The chat does not send reasoning unless asked to
    expect(ofType(events, 'reasoning-delta')).toHaveLength(0);

    const history = [...(await loft.chat.getChatHistory(session.id))];
    const saved = history.filter((message) => message.role === Type.LLM.UnifiedMessageRole.assistant).at(-1);
    expect(textOf(saved)).toBe(finish?.text);
  }, 60000);

  it('tool round emits tool-call and tool-result in step 0, a later step, and the next turn is accepted', async () => {
    const { loft, session } = await setup(true);
    const events: Chat.ChatStreamEvent[] = [];

    const result = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [userMessage('Calculate 2+2 with the add tool.', session.id)],
      onEvent: (event) => events.push(event)
    });
    await result.messages.save();

    expectWellFormed(events);
    const toolCall = ofType(events, 'tool-call').find((event) => event.name === 'add');
    expect(toolCall?.step).toBe(0);
    expect(ofType(events, 'tool-result')).toContainEqual(
      expect.objectContaining({ step: 0, name: 'add', status: 'succeeded', toolCallId: toolCall?.toolCallId })
    );
    expect(ofType(events, 'step-finish').some((event) => event.step >= 1)).toBe(true);
    expect(ofType(events, 'finish')).toHaveLength(1);
    // The tool input JSON never reaches the client as text
    expect(
      ofType(events, 'text-delta')
        .map((event) => event.delta)
        .join('')
    ).not.toMatch(/"a"\s*:/);

    // The saved tool round, thinking blocks included, is accepted on the next turn
    const followUp: Chat.ChatStreamEvent[] = [];
    await loft.chat.generate({
      sessionId: session.id,
      directMessages: [userMessage('Now add 5 to that result.', session.id)],
      onEvent: (event) => followUp.push(event)
    });
    expectWellFormed(followUp);
    expect(ofType(followUp, 'finish')).toHaveLength(1);
  }, 90000);

  it('abort after the first text-delta: one abort event, generate rejects, nothing saved', async () => {
    const { loft, session } = await setup();
    const controller = new AbortController();
    const events: Chat.ChatStreamEvent[] = [];

    const generation = loft.chat.generate({
      sessionId: session.id,
      directMessages: [
        userMessage('Without calling any tool, write a 400-word story about a lighthouse keeper.', session.id)
      ],
      signal: controller.signal,
      onEvent: (event) => {
        events.push(event);
        if (event.type === 'text-delta') controller.abort();
      }
    });

    // generate() wraps the SDK's abort error in a GenerateError. The class is compared by name, as the CJS run loads
    // the SDK's CommonJS build in the strategy and its ES module build here
    const error = await generation.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GenerateError);
    expect((error as GenerateError).cause?.constructor.name).toBe('APIUserAbortError');
    expectWellFormed(events);
    expect(ofType(events, 'abort')).toHaveLength(1);
    expect(ofType(events, 'finish')).toHaveLength(0);
    expect([...(await loft.chat.getChatHistory(session.id))]).toHaveLength(0);
  }, 60000);
});
