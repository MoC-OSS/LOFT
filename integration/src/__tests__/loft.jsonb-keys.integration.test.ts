import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDB, type TestDatabaseInstance } from './initDB';
import { SCRIPTED_LLM, startScriptedChat, userMessage } from './scriptedChat';

// The repositories convert column names to camelCase; keys inside the jsonb columns are user and provider data, such as
// tool arguments, a provider's _meta or the session ctx, and must come back as they were written
describe('Keys inside jsonb columns', () => {
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

  it('keeps the keys of message content in the chat history', async () => {
    const { loft, session } = await startScriptedChat(testDb, [
      { toolCalls: [{ name: 'book_table', arguments: { party_size: 2, start_time: '19:00' } }] },
      { text: 'Booked' }
    ]);
    const message = userMessage('Book a table', session.id);
    message.content = [{ type: 'text', text: 'Book a table', _meta: { provider_signature: 'sig-1' } }];

    const result = await loft.chat.generate({ sessionId: session.id, directMessages: [message] });
    await result.messages.save();

    const content = [...(await loft.chat.getChatHistory(session.id))].flatMap((m) => m.content);
    expect(content).toContainEqual(expect.objectContaining({ _meta: { provider_signature: 'sig-1' } }));
    expect(content).toContainEqual(
      expect.objectContaining({
        type: 'tool_call',
        params: expect.objectContaining({ arguments: { party_size: 2, start_time: '19:00' } })
      })
    );
  });

  it('keeps the keys of the session ctx', async () => {
    const { loft } = await startScriptedChat(testDb, []);
    const session = await loft.chat.createSession({
      currentLlmName: SCRIPTED_LLM,
      currentManifestName: 'test-bot',
      ctx: { user_id: 'u-1', billing_plan: { plan_name: 'pro' } }
    });

    expect((await loft.chat.getSessionById(session.id)).ctx).toEqual({
      user_id: 'u-1',
      billing_plan: { plan_name: 'pro' }
    });
  });
});
