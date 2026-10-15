import 'reflect-metadata';

import { Interface, Type } from '@moc-global/loft-definitions';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDB, type TestDatabaseInstance } from './initDB';
import { InitClientServer } from './mcpClientServerInMemory';
import { startScriptedChat, summarize, userMessage } from './scriptedChat';

const { user, assistant, tool } = Type.LLM.UnifiedMessageRole;

describe('Tool interceptors', () => {
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

  it('passes the call, the tool, the chain, the limits and the client metadata to the interceptor', async () => {
    const seen: Interface.ToolInterceptorParams[] = [];
    let chainRolesAtCall: string[] = [];
    const { loft, llm, session } = await startScriptedChat(
      testDb,
      [{ toolCalls: [{ name: 'add', arguments: { a: 5, b: 3 } }] }, { text: '5 + 3 = 8' }],
      {
        mcpClients: { calculator: await InitClientServer() },
        mcpMetadata: { calculator: { environment: 'test', priority: 100 } },
        configure: ({ chatConstructor }) =>
          chatConstructor.registerToolInterceptor('add', async (params) => {
            seen.push(params);
            // toolChain is the live chain, which grows after the call, so its state is read here
            chainRolesAtCall = params.toolChain.map((message) => message.role);
            return params.executeToolFn({ params: params.toolRequest.params });
          })
      }
    );

    const result = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [userMessage('What is 5 + 3?', session.id)]
    });

    expect(seen).toHaveLength(1);
    const [{ toolRequest, calledTool, callLimits, toolClients, ctx }] = seen;
    expect(toolRequest.params).toEqual({ name: 'add', arguments: { a: 5, b: 3 } });
    expect(calledTool.name).toBe('add');
    expect(Object.keys(calledTool.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(['a', 'b']));
    // The assistant message that made the call is already in the chain
    expect(chainRolesAtCall).toEqual([assistant]);
    expect(callLimits).toEqual({ current: 1, max: 10 });
    expect(ctx.session.id).toBe(session.id);
    expect(toolClients).toHaveLength(1);
    expect(toolClients[0].clientName).toBe('calculator');
    expect(toolClients[0].metadata).toMatchObject({
      transportType: 'inmemory',
      environment: 'test',
      priority: 100
    });
    // The calculator server's add, subtract, multiply and divide tools
    expect(toolClients[0].metadata.toolCount).toBe(4);
    expect(Number.isNaN(Date.parse(toolClients[0].metadata.registeredAt))).toBe(false);

    // The model got the interceptor's result and answered
    expect(llm.calls[1].messages.at(-1)?.toolResults).toEqual([
      { callId: toolRequest.callId, text: '8', isError: false }
    ]);
    expect(summarize(result.messages.llmResponse.topChoice).text).toBe('5 + 3 = 8');
  });

  it('calls the MCP tool directly when no interceptor is registered for it', async () => {
    let intercepted = false;
    const { loft, session } = await startScriptedChat(
      testDb,
      [{ toolCalls: [{ name: 'subtract', arguments: { a: 10, b: 4 } }] }, { text: '6' }],
      {
        mcpClients: { calculator: await InitClientServer() },
        configure: ({ chatConstructor }) =>
          chatConstructor.registerToolInterceptor('add', async (params) => {
            intercepted = true;
            return params.executeToolFn({ params: params.toolRequest.params });
          })
      }
    );

    const result = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [userMessage('What is 10 - 4?', session.id)]
    });

    expect(intercepted).toBe(false);
    expect((result.messages.llmResponse.usedTools ?? []).map(summarize)).toEqual([
      { role: assistant, text: '', toolCalls: [{ name: 'subtract', arguments: { a: 10, b: 4 } }], toolResults: [] },
      { role: tool, text: '', toolCalls: [], toolResults: [{ text: '6', isError: false }] }
    ]);
  });

  it('lets the interceptor change the arguments, or answer without running the tool', async () => {
    const { loft, llm, session } = await startScriptedChat(
      testDb,
      [
        {
          toolCalls: [
            { name: 'add', arguments: { a: 1, b: 1 } },
            { name: 'multiply', arguments: { a: 2, b: 3 } }
          ]
        },
        { text: 'done' }
      ],
      {
        mcpClients: { calculator: await InitClientServer() },
        configure: ({ chatConstructor }) => {
          // Fills in a default the model left out
          chatConstructor.registerToolInterceptor('add', async ({ toolRequest, executeToolFn }) =>
            executeToolFn({ params: { ...toolRequest.params, arguments: { ...toolRequest.params.arguments, b: 10 } } })
          );
          // Refuses the call, as an access check would
          chatConstructor.registerToolInterceptor('multiply', async () => ({
            content: [{ type: 'text', text: 'multiply is not allowed for this user' }],
            isError: true
          }));
        }
      }
    );

    await loft.chat.generate({
      sessionId: session.id,
      directMessages: [userMessage('Calculate', session.id)]
    });

    expect(llm.calls).toHaveLength(2);
    const results = llm.calls[1].messages.flatMap((message) => message.toolResults);
    expect(results.map(({ text, isError }) => ({ text, isError }))).toEqual([
      { text: '11', isError: false },
      { text: 'multiply is not allowed for this user', isError: true }
    ]);
  });

  it('ends the turn with the interceptor’s message when it calls preventGenerate()', async () => {
    const { loft, llm, session } = await startScriptedChat(
      testDb,
      // A second model call would fail: the script has no reply for it
      [{ toolCalls: [{ name: 'add', arguments: { a: 5, b: 3 } }] }],
      {
        mcpClients: { calculator: await InitClientServer() },
        configure: ({ chatConstructor }) =>
          chatConstructor.registerToolInterceptor('add', async ({ preventGenerate, executeToolFn, toolRequest }) => {
            const toolResult = await executeToolFn({ params: toolRequest.params });
            preventGenerate({ content: [{ type: 'text', text: 'Done by the interceptor.' }], role: assistant });
            return toolResult;
          })
      }
    );

    const result = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [userMessage('What is 5 + 3?', session.id)]
    });

    expect(llm.calls).toHaveLength(1);
    const { topChoice, usedTools, originalResponse, usage } = result.messages.llmResponse;
    expect(summarize(topChoice)).toMatchObject({ role: assistant, text: 'Done by the interceptor.' });
    expect(topChoice.author).toBe('tool_interceptor');
    expect(originalResponse).toEqual({ generatedByToolInterceptor: true });
    expect(usage.finishReason).toBe('interceptor_override');
    expect((usedTools ?? []).map((message) => summarize(message).role)).toEqual([assistant, tool]);
    expect(summarize(usedTools![1]).toolResults).toEqual([{ text: '8', isError: false }]);

    // The stored turn is the question, the call, its result and the interceptor's answer
    await result.messages.save();
    const history = await loft.chat.getChatHistory(session.id);
    expect(history.map((message) => [message.role, message.author])).toEqual([
      [user, 'user'],
      [assistant, 'assistant'],
      [tool, 'tool-add'],
      [assistant, 'tool_interceptor']
    ]);
  });
});
