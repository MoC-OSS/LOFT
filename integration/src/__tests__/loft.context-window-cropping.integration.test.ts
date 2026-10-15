import 'reflect-metadata';

import { Type } from '@moc-global/loft-definitions';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { initDB, type TestDatabaseInstance } from './initDB';
import { expectIntactToolChain, startScriptedChat, summarize, userMessage } from './scriptedChat';

const { user, assistant, tool } = Type.LLM.UnifiedMessageRole;

async function createRoomSearchClient(): Promise<Client> {
  const server = new McpServer({ name: 'room-search-server', version: '1.0.0' });
  server.tool('get_available_residences', {}, async () => ({
    content: [{ type: 'text', text: 'Riverside, Harbour' }]
  }));
  server.tool(
    'room_search',
    { residenceName: z.string(), roomType: z.string() },
    async ({ residenceName, roomType }) => ({
      content: [{ type: 'text', text: `${roomType} at ${residenceName}: room-123` }]
    })
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'room-search-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

describe('Context window cropping', () => {
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

  it('crops the history to the window size without splitting a tool call from its result', async () => {
    const { loft, llm, session } = await startScriptedChat(
      testDb,
      [
        // Turn 1: two tool calls in a row, then an answer
        { toolCalls: [{ name: 'get_available_residences' }] },
        { toolCalls: [{ name: 'room_search', arguments: { residenceName: 'Riverside', roomType: 'Studio' } }] },
        { text: 'Riverside has a studio.' },
        // Turn 2: one tool call
        { toolCalls: [{ name: 'room_search', arguments: { residenceName: 'Harbour', roomType: 'Standard' } }] },
        { text: 'Harbour has a standard room.' },
        // Turn 3: two parallel tool calls
        {
          toolCalls: [
            { name: 'get_available_residences' },
            { name: 'room_search', arguments: { residenceName: 'Harbour', roomType: 'Premium' } }
          ]
        },
        { text: 'Here is everything.' }
      ],
      { mcpClients: { 'room-search': await createRoomSearchClient() } }
    );

    for (const text of ['Find a studio', 'And at Harbour?', 'Show me everything']) {
      const result = await loft.chat.generate({
        sessionId: session.id,
        directMessages: [userMessage(text, session.id)],
        llmContextWindow: 2
      });
      await result.messages.save();
    }

    expect(llm.calls).toHaveLength(7);
    // No window the model received breaks a tool chain
    for (const call of llm.calls) expectIntactToolChain(call.messages);

    // With a window of 2, the oldest messages kept are a safe start: the last plain answer, or the user message
    // when the newest messages are part of a tool chain
    const window = (call: number) =>
      llm.calls[call].messages.map(({ role, text, toolCalls, toolResults }) => ({
        role,
        text,
        toolCalls: toolCalls.length,
        toolResults: toolResults.length
      }));

    // Turn 1, second call: [user, assistant(call), tool] can only start at the user message
    expect(window(1)).toEqual([
      { role: user, text: 'Find a studio', toolCalls: 0, toolResults: 0 },
      { role: assistant, text: '', toolCalls: 1, toolResults: 0 },
      { role: tool, text: '', toolCalls: 0, toolResults: 1 }
    ]);
    // Turn 3, first call: the last answer of turn 2 and the new question; turns 1 and 2's tool chains are cropped
    expect(window(5)).toEqual([
      { role: assistant, text: 'Harbour has a standard room.', toolCalls: 0, toolResults: 0 },
      { role: user, text: 'Show me everything', toolCalls: 0, toolResults: 0 }
    ]);
    // Turn 3, second call: the parallel calls keep both results, so the window grows from 2 to 4
    expect(window(6)).toEqual([
      { role: user, text: 'Show me everything', toolCalls: 0, toolResults: 0 },
      { role: assistant, text: '', toolCalls: 2, toolResults: 0 },
      { role: tool, text: '', toolCalls: 0, toolResults: 1 },
      { role: tool, text: '', toolCalls: 0, toolResults: 1 }
    ]);

    // Cropping changes only what the model sees; the history keeps every message
    const history = await loft.chat.getChatHistory(session.id);
    expect(history.map((message) => summarize(message).role)).toEqual([
      user,
      assistant,
      tool,
      assistant,
      tool,
      assistant,
      user,
      assistant,
      tool,
      assistant,
      user,
      assistant,
      tool,
      tool,
      assistant
    ]);
  });
});
