import 'reflect-metadata';

import { GenerateError } from '@moc-global/loft-definitions';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDB, type TestDatabaseInstance } from './initDB';
import { startScriptedChat, userMessage } from './scriptedChat';

async function generateError(promise: Promise<unknown>): Promise<GenerateError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(GenerateError);
  return error as GenerateError;
}

describe('GenerateError', () => {
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

  it('carries the provider error as its cause', async () => {
    const providerError = new Error('provider is down');
    const { loft, session } = await startScriptedChat(testDb, [{ error: providerError }]);

    const error = await generateError(
      loft.chat.generate({ sessionId: session.id, directMessages: [userMessage('Hello', session.id)] })
    );

    expect(error.cause).toBe(providerError);
    expect(error.message).toBe('provider is down');
    expect(error.stack).toContain('Caused by: Error: provider is down');
  });

  it('carries a failing middleware error, with the middleware error as its cause', async () => {
    const middlewareError = new Error('policy check failed');
    const { loft, session } = await startScriptedChat(testDb, [{ text: 'never sent' }], {
      configure: ({ chatConstructor }) => {
        chatConstructor.registerBeforeGenerateMiddleware('policy', async () => {
          throw middlewareError;
        });
      }
    });

    const error = await generateError(
      loft.chat.generate({ sessionId: session.id, directMessages: [userMessage('Hello', session.id)] })
    );

    expect(error.cause).toBeInstanceOf(Error);
    expect((error.cause as Error).message).toContain('Forced failure in middleware: policy');
    expect((error.cause as Error).cause).toBe(middlewareError);
  });
});
