import 'reflect-metadata';

import { ShutdownError } from '@moc-global/loft-definitions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initDB, type TestDatabaseInstance } from './initDB';
import { startScriptedChat, userMessage } from './scriptedChat';

describe('LOFT.shutdown', () => {
  let testDb: TestDatabaseInstance;

  beforeAll(async () => {
    testDb = await initDB();
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it('lets a request in flight finish, and rejects requests after it', async () => {
    let releaseMiddleware!: () => void;
    const middlewareReleased = new Promise<void>((resolve) => (releaseMiddleware = resolve));
    let middlewareReached!: () => void;
    const reached = new Promise<void>((resolve) => (middlewareReached = resolve));
    const { loft, session } = await startScriptedChat(testDb, [{ text: 'Finished.' }], {
      configure: ({ chatConstructor }) => {
        chatConstructor.registerInputMiddleware('wait', async (_ctx, payload, chain) => {
          middlewareReached();
          await middlewareReleased;
          chain.next();
          return payload;
        });
      }
    });

    const request = loft.chat.generate({ sessionId: session.id, directMessages: [userMessage('Hi', session.id)] });
    await reached;
    // shutdown() starts while the request waits; the LLM call that follows (callAndHandle) is a nested operation
    const shutdown = loft.shutdown();
    releaseMiddleware();

    const result = await request;
    expect(result.messages.llmResponse.topChoice.content).toEqual([{ type: 'text', text: 'Finished.' }]);
    await shutdown;
    await expect(
      loft.chat.generate({ sessionId: session.id, directMessages: [userMessage('Again', session.id)] })
    ).rejects.toBeInstanceOf(ShutdownError);
  });
});
