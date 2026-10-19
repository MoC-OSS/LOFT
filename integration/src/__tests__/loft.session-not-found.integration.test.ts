import 'reflect-metadata';

import { SessionNotFoundError } from '@moc-global/loft-definitions';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDB, type TestDatabaseInstance } from './initDB';
import { startScriptedChat, userMessage } from './scriptedChat';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

async function notFoundError(promise: Promise<unknown>): Promise<SessionNotFoundError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(SessionNotFoundError);
  return error as SessionNotFoundError;
}

describe('SessionNotFoundError', () => {
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

  it.each([
    [
      'generate',
      (chat: Chat) => chat.generate({ sessionId: MISSING_ID, directMessages: [userMessage('Hi', MISSING_ID)] })
    ],
    ['addMessages', (chat: Chat) => chat.addMessages(MISSING_ID, [], [userMessage('Hi', MISSING_ID)])],
    ['getSessionById', (chat: Chat) => chat.getSessionById(MISSING_ID)],
    ['updateSessionSettings', (chat: Chat) => chat.updateSessionSettings(MISSING_ID, 'correlator', { ctx: {} })],
    ['deleteSession', (chat: Chat) => chat.deleteSession(MISSING_ID)]
  ])('%s rejects for a missing session', async (_method, call) => {
    const { loft } = await startScriptedChat(testDb, []);

    const error = await notFoundError(call(loft.chat));

    expect(error.sessionId).toBe(MISSING_ID);
    // The message is unchanged, so code that matches it keeps working
    expect(error.message).toBe(`Session with id ${MISSING_ID} not found`);
  });

  it('getSessionByExternalKey rejects for a missing session', async () => {
    const { loft } = await startScriptedChat(testDb, []);

    const error = await notFoundError(loft.chat.getSessionByExternalKey({ crmId: 'missing' }));

    expect(error.externalKey).toEqual({ crmId: 'missing' });
    expect(error.message).toBe('Session with externalKey {"crmId":"missing"} not found');
  });

  it('rejects for a session deleted before', async () => {
    const { loft, session } = await startScriptedChat(testDb, []);
    await loft.chat.deleteSession(session.id);

    await notFoundError(loft.chat.generate({ sessionId: session.id, directMessages: [userMessage('Hi', session.id)] }));
  });
});

type Chat = Awaited<ReturnType<typeof startScriptedChat>>['loft']['chat'];
