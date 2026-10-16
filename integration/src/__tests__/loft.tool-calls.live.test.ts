import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { Type } from '@moc-global/loft-definitions';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { initAnthropicStrategy } from './AnthropicStrategyWithCallManager';
import { hasKeys } from './config';
import { initDB, type TestDatabaseInstance } from './initDB';
import { createChatConstructor, createLoftConstructor } from './loftInit';
import { initOpenAiStrategy } from './OpenAiStrategyWithCallManager';

const BOOKING_ERROR = 'No table is free at 19:00';

type ToolCallPart = Extract<Type.Entity.FullContentPart, { type: 'tool_call' }>;
type ToolResultPart = Extract<Type.Entity.FullContentPart, { type: 'tool_result' }>;

// Weather and time always answer; booking always fails and says why
async function initTravelClient(): Promise<Client> {
  const server = new McpServer({ name: 'travel', version: '0.1.0' });
  server.tool('get_weather', { city: z.string(), context: z.any().optional() }, async ({ city }) => ({
    content: [{ type: 'text', text: `${city}: 18°C, cloudy` }]
  }));
  server.tool('get_time', { city: z.string(), context: z.any().optional() }, async ({ city }) => ({
    content: [{ type: 'text', text: `${city}: 14:05` }]
  }));
  server.tool('book_table', { time: z.string(), context: z.any().optional() }, async () => ({
    isError: true,
    content: [{ type: 'text', text: BOOKING_ERROR }]
  }));

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'travel-client', version: '0.1.0' });
  await client.connect(clientTransport);
  return client;
}

function userMessage(text: string, sessionId: string): Type.Entity.Message {
  return {
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
  };
}

const toolCalls = (messages: Pick<Type.Entity.Message, 'content'>[]): ToolCallPart[] =>
  messages.flatMap((m) => m.content.filter((part): part is ToolCallPart => part.type === 'tool_call'));

const toolResults = (messages: Pick<Type.Entity.Message, 'content'>[]): ToolResultPart[] =>
  messages.flatMap((m) => m.content.filter((part): part is ToolResultPart => part.type === 'tool_result'));

const resultText = (part: ToolResultPart): string =>
  part.content.map((item) => (item.type === 'text' ? item.text : '')).join('');

type LoftConstructor = ReturnType<typeof createLoftConstructor>;

// Each provider registers its own strategy type, so the registration is a function per provider
const PROVIDERS = [
  {
    provider: 'OpenAI',
    key: 'LOFT_OPENAI_API_KEY' as const,
    llmName: 'gpt-4o-mini-tool-calls',
    register: (lc: LoftConstructor, name: string) => lc.registerLlmStrategy(name, initOpenAiStrategy(name))
  },
  {
    provider: 'Anthropic',
    key: 'LOFT_ANTHROPIC_API_KEY' as const,
    llmName: 'claude-haiku-tool-calls',
    register: (lc: LoftConstructor, name: string) => lc.registerLlmStrategy(name, initAnthropicStrategy(name))
  },
  {
    // Claude Sonnet 5.5 takes no sampling parameters and turns thinking off only with between_tools
    provider: 'Anthropic, thinking between_tools',
    key: 'LOFT_ANTHROPIC_API_KEY' as const,
    llmName: 'claude-sonnet-thinking-off-tool-calls',
    register: (lc: LoftConstructor, name: string) => lc.registerLlmStrategy(name, initAnthropicStrategy(name))
  }
];

// Live: runs each provider whose key is set in .env.test
const AVAILABLE = PROVIDERS.filter(({ key }) => hasKeys(key));

describe.runIf(AVAILABLE.length > 0)('Loft tool calls with real providers', () => {
  let testDb: TestDatabaseInstance;

  beforeAll(async () => {
    testDb = await initDB();
  });

  afterAll(async () => {
    await testDb?.close();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
  });

  async function startChat(llmName: string, register: (typeof PROVIDERS)[number]['register']) {
    const chatConstructor = createChatConstructor(testDb);
    const loftConstructor = createLoftConstructor(chatConstructor);
    await register(loftConstructor, llmName);
    await chatConstructor.useMcpClient('travel', await initTravelClient());
    const loft = loftConstructor.getInstance();
    const session = await loft.chat.createSession({
      currentLlmName: llmName,
      currentManifestName: 'test-bot',
      ctx: {}
    });
    return { loft, session };
  }

  describe.each(AVAILABLE.length > 0 ? AVAILABLE : PROVIDERS)('$provider', ({ llmName, register }) => {
    it('answers parallel tool calls and saves every result to chat history', async () => {
      const { loft, session } = await startChat(llmName, register);

      const result = await loft.chat.generate({
        sessionId: session.id,
        directMessages: [userMessage('What are the weather and the local time in Kyiv right now?', session.id)]
      });

      const usedTools = result.messages.llmResponse.usedTools ?? [];
      const calls = toolCalls(usedTools);
      const results = toolResults(usedTools);
      const assistantCallCounts = usedTools
        .filter((m) => m.role === Type.LLM.UnifiedMessageRole.assistant)
        .map((m) => toolCalls([m]).length);

      // Both tools were called in one assistant message, and each call got exactly one result
      expect(Math.max(0, ...assistantCallCounts)).toBeGreaterThanOrEqual(2);
      expect(results.map((r) => r.callId).sort()).toEqual(calls.map((c) => c.callId).sort());
      // The provider accepted the results and answered from them
      const answer = result.messages.llmResponse.topChoice.content
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('');
      expect(answer).toContain('18');
      expect(answer).toContain('14:05');

      await result.messages.save();

      const history = [...(await loft.chat.getChatHistory(session.id))];
      expect(
        toolResults(history)
          .map((r) => r.callId)
          .sort()
      ).toEqual(calls.map((c) => c.callId).sort());
    }, 60000);

    it("gives the model a failed tool's own error text", async () => {
      const { loft, session } = await startChat(llmName, register);

      const result = await loft.chat.generate({
        sessionId: session.id,
        directMessages: [userMessage('Book a table for 19:00 tonight.', session.id)]
      });

      const usedTools = result.messages.llmResponse.usedTools ?? [];
      const bookingCallIds = toolCalls(usedTools)
        .filter((call) => call.params.name === 'book_table')
        .map((call) => call.callId);
      const bookingResults = toolResults(usedTools).filter((r) => bookingCallIds.includes(r.callId));
      expect(bookingResults.length).toBeGreaterThanOrEqual(1);
      expect(bookingResults[0].isError).toBe(true);
      expect(resultText(bookingResults[0])).toBe(BOOKING_ERROR);
    }, 60000);
  });

  it('rejects a message that belongs to another session', async () => {
    const { loft, session } = await startChat(PROVIDERS[0].llmName, PROVIDERS[0].register);
    const otherSession = await loft.chat.createSession({
      currentLlmName: PROVIDERS[0].llmName,
      currentManifestName: 'test-bot',
      ctx: {}
    });

    const chat = loft.chat;
    if (!('addMessages' in chat)) throw new Error('Expected the base chat, which has addMessages');

    await expect(chat.addMessages(session.id, [randomUUID()], [userMessage('Hello', otherSession.id)])).rejects.toThrow(
      `Cannot add a message of session ${otherSession.id} to session ${session.id}`
    );

    expect([...(await loft.chat.getChatHistory(session.id))]).toHaveLength(0);
    expect([...(await loft.chat.getChatHistory(otherSession.id))]).toHaveLength(0);
  }, 30000);
});
