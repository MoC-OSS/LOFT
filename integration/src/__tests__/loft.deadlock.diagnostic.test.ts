import { randomUUID } from 'node:crypto';

import { Type } from '@moc-global/loft-definitions';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDB, type TestDatabaseInstance } from './initDB';
import { createChatConstructor, createLoftConstructor } from './loftInit';
import { EchoLLMStrategy } from './mocks/EchoLLMStrategy';

function createTestMessage(text: string, sessionId: string): Type.Entity.CreateMessage {
  return {
    id: randomUUID(),
    sessionId,
    ctx: {},
    llmName: 'gpt-4o-mini',
    manifestName: 'test-bot',
    content: [{ type: 'text', text }],
    role: Type.LLM.UnifiedMessageRole.user,
    author: 'user',
    llmIgnore: false
  };
}

describe('Loft Deadlock Diagnostic Tests', () => {
  let testDb: TestDatabaseInstance;

  beforeAll(async () => {
    testDb = await initDB();
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
  });

  async function createLoftInstance(name: string) {
    const chatConstructor = createChatConstructor(testDb);
    const loftConstructor = createLoftConstructor(chatConstructor);

    // Register a unique Echo LLM strategy instance for each constructor
    const echoStrategy = new EchoLLMStrategy(`gpt-4o-mini-${name}`);
    await loftConstructor.registerLlmStrategy('gpt-4o-mini', echoStrategy);

    return loftConstructor.getInstance();
  }

  it('should handle sequential generation without issues', async () => {
    const loft = await createLoftInstance('sequential');

    const session1 = await loft.chat.createSession({
      currentLlmName: 'gpt-4o-mini',
      currentManifestName: 'test-bot',
      ctx: {}
    });

    const session2 = await loft.chat.createSession({
      currentLlmName: 'gpt-4o-mini',
      currentManifestName: 'test-bot',
      ctx: {}
    });

    console.log('Testing sequential generation...');

    const result1 = await loft.chat.generate({
      sessionId: session1.id,
      directMessages: [createTestMessage('Test 1', session1.id)]
    });
    console.log('Session 1 completed');

    const result2 = await loft.chat.generate({
      sessionId: session2.id,
      directMessages: [createTestMessage('Test 2', session2.id)]
    });
    console.log('Session 2 completed');

    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
  });

  it('should handle parallel generation from same instance', { timeout: 10000 }, async () => {
    const loft = await createLoftInstance('parallel-same');

    const session1 = await loft.chat.createSession({
      currentLlmName: 'gpt-4o-mini',
      currentManifestName: 'test-bot',
      ctx: {}
    });

    const session2 = await loft.chat.createSession({
      currentLlmName: 'gpt-4o-mini',
      currentManifestName: 'test-bot',
      ctx: {}
    });

    console.log('Testing parallel generation from same instance...');

    const [result1, result2] = await Promise.all([
      loft.chat
        .generate({
          sessionId: session1.id,
          directMessages: [createTestMessage('Parallel Test 1', session1.id)]
        })
        .then((result) => {
          console.log('Parallel session 1 completed');
          return result;
        }),
      loft.chat
        .generate({
          sessionId: session2.id,
          directMessages: [createTestMessage('Parallel Test 2', session2.id)]
        })
        .then((result) => {
          console.log('Parallel session 2 completed');
          return result;
        })
    ]);

    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
  });

  it('should handle parallel generation from different instances', { timeout: 10000 }, async () => {
    const loft1 = await createLoftInstance('parallel-diff-1');
    const loft2 = await createLoftInstance('parallel-diff-2');

    const session1 = await loft1.chat.createSession({
      currentLlmName: 'gpt-4o-mini',
      currentManifestName: 'test-bot',
      ctx: {}
    });

    const session2 = await loft2.chat.createSession({
      currentLlmName: 'gpt-4o-mini',
      currentManifestName: 'test-bot',
      ctx: {}
    });

    console.log('Testing parallel generation from different instances...');

    const [result1, result2] = await Promise.all([
      loft1.chat
        .generate({
          sessionId: session1.id,
          directMessages: [createTestMessage('Different Instance Test 1', session1.id)]
        })
        .then((result) => {
          console.log('Different instance session 1 completed');
          return result;
        }),
      loft2.chat
        .generate({
          sessionId: session2.id,
          directMessages: [createTestMessage('Different Instance Test 2', session2.id)]
        })
        .then((result) => {
          console.log('Different instance session 2 completed');
          return result;
        })
    ]);

    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
  });

  it('should handle rapid sequential calls', { timeout: 15000 }, async () => {
    const loft = await createLoftInstance('rapid');

    const session = await loft.chat.createSession({
      currentLlmName: 'gpt-4o-mini',
      currentManifestName: 'test-bot',
      ctx: {}
    });

    console.log('Testing rapid sequential calls...');

    const promises = [];
    for (let i = 0; i < 5; i++) {
      const promise = loft.chat
        .generate({
          sessionId: session.id,
          directMessages: [createTestMessage(`Rapid Test ${i}`, session.id)]
        })
        .then((result) => {
          console.log(`Rapid call ${i} completed`);
          return result;
        });
      promises.push(promise);
    }

    const results = await Promise.all(promises);
    expect(results).toHaveLength(5);
    results.forEach((result) => expect(result).toBeDefined());
  });
});
