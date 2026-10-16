import 'reflect-metadata';

import { Type } from '@moc-global/loft-definitions';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hasKeys } from './config';
import { initGeminiStrategy } from './GeminiStrategyWithCallManager';
import { initDB, type TestDatabaseInstance } from './initDB';
import { createChatConstructor, createLoftConstructor } from './loftInit';
import { InitClientServer } from './mcpClientServerInMemory';

const createTestMessage = (
  content: string,
  sessionId: string,
  options: Partial<Type.Entity.Message> = {}
): Type.Entity.Message => ({
  id: uuidv4(),
  sequenceId: '1',
  sessionId,
  ctx: {},
  llmName: '',
  manifestName: '',
  content: [{ type: 'text', text: content }],
  role: Type.LLM.UnifiedMessageRole.user,
  author: 'user',
  llmIgnore: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...options
});

// Live: needs LOFT_GEMINI_VERTEX_PROJECT and Application Default Credentials for that project
describe.runIf(hasKeys('LOFT_GEMINI_VERTEX_PROJECT'))('Loft Gemini MCP Integration Tests', () => {
  let testDb: TestDatabaseInstance;

  beforeAll(async () => {
    testDb = await initDB();
  }, 30000);

  afterAll(async () => {
    try {
      if (testDb) {
        await testDb.close();
      }
    } catch (error) {
      console.error('Error closing test database:', error);
    }
  });

  beforeEach(async () => {
    await testDb.truncateAll();
  });

  it('should use calculator tools with Gemini (sequential: add then multiply)', async () => {
    const chatConstructor = createChatConstructor(testDb);
    const loftConstructor = createLoftConstructor(chatConstructor);
    const loft = loftConstructor.getInstance();

    await loftConstructor.registerLlmStrategy(
      'gemini-3-1-flash-lite-tooled-calculator',
      initGeminiStrategy('gemini-3-1-flash-lite-tooled-calculator')
    );

    const calculatorClient = await InitClientServer();
    chatConstructor.useMcpClient('calculator', calculatorClient);

    const session = await loft.chat.createSession({
      currentLlmName: 'gemini-3-1-flash-lite-tooled-calculator',
      currentManifestName: 'test-bot',
      ctx: {}
    });

    const result = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [createTestMessage('Calculate 2+2 and multiply the result by 3', session.id)]
    });

    console.log('RESULT: ', JSON.stringify(result.messages.llmResponse.topChoice, null, 2));

    // Verify usedTools in the response
    expect(result.messages.llmResponse.usedTools).toBeDefined();
    if (result.messages.llmResponse.usedTools) {
      expect(result.messages.llmResponse.usedTools.length).toBeGreaterThanOrEqual(4);

      // Check that add and multiply tools were called
      const toolCalls = result.messages.llmResponse.usedTools
        .flatMap((msg) => msg.content)
        .filter((c: any) => c.type === 'tool_call');

      const addCall = toolCalls.find((c: any) => c.params?.name === 'add');
      const multiplyCall = toolCalls.find((c: any) => c.params?.name === 'multiply');

      expect(addCall).toBeDefined();
      expect(multiplyCall).toBeDefined();
    }

    await result.messages.save();

    // Gemini 3 rejects function calls sent back without their thought signatures; the saved history keeps them, so
    // the next turn, which sends that history, is accepted
    const history = [...(await loft.chat.getChatHistory(session.id))];
    expect(
      history
        .flatMap((msg) => msg.content)
        .some((c) => c.type === 'tool_call' && typeof c._meta?.geminiThoughtSignature === 'string')
    ).toBe(true);

    const followUp = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [createTestMessage('Now add 5 to that result', session.id)]
    });
    expect(followUp.messages.llmResponse.topChoice.content.length).toBeGreaterThan(0);
  }, 90000);

  it('should handle parallel tool calls with Gemini', async () => {
    const chatConstructor = createChatConstructor(testDb);
    const loftConstructor = createLoftConstructor(chatConstructor);
    const loft = loftConstructor.getInstance();

    await loftConstructor.registerLlmStrategy(
      'gemini-3-1-flash-lite-tooled-calculator',
      initGeminiStrategy('gemini-3-1-flash-lite-tooled-calculator')
    );

    const calculatorClient = await InitClientServer();
    chatConstructor.useMcpClient('calculator', calculatorClient);

    const session = await loft.chat.createSession({
      currentLlmName: 'gemini-3-1-flash-lite-tooled-calculator',
      currentManifestName: 'test-bot',
      ctx: {}
    });

    // Ask for two independent calculations that could be done in parallel
    const result = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [createTestMessage('Calculate both 10+5 and 3*4', session.id)]
    });

    console.log('PARALLEL RESULT: ', JSON.stringify(result.messages.llmResponse.topChoice, null, 2));

    expect(result.messages.llmResponse.usedTools).toBeDefined();
    if (result.messages.llmResponse.usedTools) {
      const toolCalls = result.messages.llmResponse.usedTools
        .flatMap((msg) => msg.content)
        .filter((c: any) => c.type === 'tool_call');

      // Should have at least 2 tool calls (add and multiply)
      expect(toolCalls.length).toBeGreaterThanOrEqual(2);

      const addCall = toolCalls.find((c: any) => c.params?.name === 'add');
      const multiplyCall = toolCalls.find((c: any) => c.params?.name === 'multiply');

      expect(addCall).toBeDefined();
      expect(multiplyCall).toBeDefined();
    }

    await result.messages.save();
  }, 60000);

  it('should handle complex multi-step calculation with Gemini', async () => {
    const chatConstructor = createChatConstructor(testDb);
    const loftConstructor = createLoftConstructor(chatConstructor);
    const loft = loftConstructor.getInstance();

    await loftConstructor.registerLlmStrategy(
      'gemini-3-1-flash-lite-tooled-calculator',
      initGeminiStrategy('gemini-3-1-flash-lite-tooled-calculator')
    );

    const calculatorClient = await InitClientServer();
    chatConstructor.useMcpClient('calculator', calculatorClient);

    const session = await loft.chat.createSession({
      currentLlmName: 'gemini-3-1-flash-lite-tooled-calculator',
      currentManifestName: 'test-bot',
      ctx: {}
    });

    // Complex expression: (10+5) * 2 + (3*4) = 15 * 2 + 12 = 30 + 12 = 42
    const result = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [createTestMessage('Calculate (10+5) * 2 + (3*4)', session.id)]
    });

    console.log('COMPLEX RESULT: ', JSON.stringify(result.messages.llmResponse.topChoice, null, 2));

    // Log tool types sequence
    console.log('\n=== TOOL TYPES SEQUENCE ===');
    result.messages.llmResponse.usedTools?.forEach((msg) => {
      msg.content.forEach((c: any) => {
        console.log(c.type);
      });
    });
    console.log('===========================\n');

    expect(result.messages.llmResponse.usedTools).toBeDefined();
    if (result.messages.llmResponse.usedTools) {
      // Should have multiple tool calls for this complex expression
      expect(result.messages.llmResponse.usedTools.length).toBeGreaterThanOrEqual(4);

      const toolCalls = result.messages.llmResponse.usedTools
        .flatMap((msg) => msg.content)
        .filter((c: any) => c.type === 'tool_call');

      const toolResults = result.messages.llmResponse.usedTools
        .flatMap((msg) => msg.content)
        .filter((c: any) => c.type === 'tool_result');

      // Verify we have both calls and results
      expect(toolCalls.length).toBeGreaterThanOrEqual(3);
      expect(toolResults.length).toBeGreaterThanOrEqual(3);
    }

    await result.messages.save();
  }, 90000);
});
