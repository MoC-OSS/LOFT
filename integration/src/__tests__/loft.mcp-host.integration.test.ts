import 'reflect-metadata';

import { Type } from '@moc-global/loft-definitions';
import { ScriptedReply } from '@moc-global/loft-test-suite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { InitErrorEmulatingClientServer } from './errorEmulatingMcpServer';
import { initDB, type TestDatabaseInstance } from './initDB';
import { InitClientServer } from './mcpClientServerInMemory';
import {
  expectIntactToolChain,
  startScriptedChat,
  summarize,
  textOf,
  toolResultsIn,
  userMessage
} from './scriptedChat';

const { user, assistant, tool, system } = Type.LLM.UnifiedMessageRole;

const ALL_ERRORS = {
  shouldDisconnect: true,
  shouldReturnMalformedResponse: true,
  shouldReturnPartialResponse: true,
  shouldReturnEmptyResponse: true,
  shouldThrowException: true,
  missingToolNames: [],
  extraToolResults: true
};

describe('MCP tool loop', () => {
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

  it('answers every tool call with one result, whether the tool works, fails or does not exist', async () => {
    const tools = [
      'test_normal',
      'test_malformed',
      'test_partial',
      'test_empty',
      'test_exception',
      'test_disconnect',
      'test_multiple',
      'not_offered'
    ];
    const { client } = await InitErrorEmulatingClientServer(ALL_ERRORS);
    const { loft, llm, session } = await startScriptedChat(
      testDb,
      [{ toolCalls: tools.map((name) => ({ name, arguments: { value: 'v' } })) }, { text: 'Handled.' }],
      { mcpClients: { emulator: client } }
    );

    const result = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [userMessage('Run every tool', session.id)]
    });

    // The second model call sees all eight results, in a chain the providers accept
    const window = llm.calls[1].messages;
    expectIntactToolChain(window);
    const results = Object.fromEntries(
      window
        .flatMap((message) => message.toolResults)
        .map(({ callId, text, isError }) => [callId?.split(':::')[0], { text, isError }])
    );
    expect(results).toEqual({
      test_normal: { text: 'Normal response: v', isError: false },
      // The client rejects a result that breaks the MCP schema
      test_malformed: { text: expect.stringContaining('Invalid tools/call result'), isError: true },
      test_partial: { text: '', isError: false },
      test_empty: { text: '', isError: false },
      test_exception: { text: 'Simulated exception for value: v', isError: true },
      test_disconnect: { text: 'Connection lost', isError: true },
      test_multiple: { text: 'Multiple test part 1: vMultiple test part 2: v', isError: false },
      not_offered: { text: 'Error: Tool "not_offered" is not supported by any registered tool source', isError: true }
    });

    // One assistant message with eight calls, then one tool message per call
    const usedTools = result.messages.llmResponse.usedTools ?? [];
    expect(usedTools.map((message) => message.role)).toEqual([assistant, ...tools.map(() => tool)]);
    expect(summarize(result.messages.llmResponse.topChoice).text).toBe('Handled.');
  });

  it('offers no tools when the only MCP server has none', async () => {
    const server = new McpServer({ name: 'no-tools', version: '1.0.0' });
    server.resource('info', 'info://server', async (uri) => ({ contents: [{ uri: uri.href, text: 'no tools' }] }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'no-tools-client', version: '1.0.0' });
    await client.connect(clientTransport);

    const { loft, llm, session } = await startScriptedChat(testDb, [{ text: 'No tools here.' }], {
      mcpClients: { empty: client }
    });
    const result = await loft.chat.generate({ sessionId: session.id, directMessages: [userMessage('Hi', session.id)] });

    expect(llm.calls[0].toolNames).toEqual([]);
    expect(summarize(result.messages.llmResponse.topChoice).text).toBe('No tools here.');
  });

  it('rejects a client registration made while another is running, and offers every client’s tools', async () => {
    const { loft, chatConstructor, llm, session } = await startScriptedChat(testDb, [{ text: 'ok' }]);
    const { client: emulator } = await InitErrorEmulatingClientServer();
    const calculator = await InitClientServer();

    // Registrations must be awaited one by one (docs/guides/mcp-integration.md)
    const first = chatConstructor.useMcpClient('calculator', calculator);
    await expect(chatConstructor.useMcpClient('emulator', emulator)).rejects.toThrow(
      'useClient method is already running'
    );
    await first;
    await chatConstructor.useMcpClient('emulator', emulator);

    await loft.chat.generate({ sessionId: session.id, directMessages: [userMessage('Hi', session.id)] });

    expect([...llm.calls[0].toolNames].sort()).toEqual(
      [
        'add',
        'subtract',
        'multiply',
        'divide',
        'test_normal',
        'test_malformed',
        'test_partial',
        'test_empty',
        'test_exception',
        'test_disconnect',
        'test_missing',
        'test_multiple'
      ].sort()
    );
  });

  it('stops after 10 model calls in one generate() and keeps the history usable', async () => {
    // The model asks for another tool on every call
    const endless: ScriptedReply[] = Array.from({ length: 10 }, (_, i) => ({
      toolCalls: [{ name: 'add', arguments: { a: i, b: 1 } }]
    }));
    const { loft, llm, session } = await startScriptedChat(testDb, [...endless, { text: 'Next turn works.' }], {
      mcpClients: { calculator: await InitClientServer() }
    });

    const result = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [userMessage('Count up', session.id)]
    });

    expect(llm.calls).toHaveLength(10);
    const { topChoice, usedTools, usage, originalResponse } = result.messages.llmResponse;
    expect(topChoice.role).toBe(system);
    expect(topChoice.author).toBe('loft-mcp-tools-sequential-calls-limit-reached');
    expect(summarize(topChoice).text).toBe('Too many sequential mcp tool calls — execution chain limit reached.');
    expect(usage.finishReason).toBe('max_loops_exceeded');
    expect(originalResponse).toEqual({ limitExceeded: true, maxCount: 10, requestedCount: 10 });

    // Nine calls ran; the tenth assistant message is kept but marked llmIgnore, and its call never ran
    const chain = usedTools ?? [];
    expect(chain).toHaveLength(19);
    expect(toolResultsIn(chain).map((part) => textOf(part))).toEqual(
      Array.from({ length: 9 }, (_, i) => String(i + 1))
    );
    expect(chain.at(-1)).toMatchObject({ role: assistant, llmIgnore: true });

    // The next turn sends the stored history without the unanswered call, so the provider accepts it
    await result.messages.save();
    await loft.chat.generate({ sessionId: session.id, directMessages: [userMessage('And now?', session.id)] });
    const nextWindow = llm.calls[10].messages;
    expectIntactToolChain(nextWindow);
    expect(nextWindow.map((message) => message.role)).toEqual([
      user,
      ...Array.from({ length: 9 }, () => [assistant, tool]).flat(),
      system,
      user
    ]);
  });
});
