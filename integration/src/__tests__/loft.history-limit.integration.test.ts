import 'reflect-metadata';

import { Type } from '@moc-global/loft-definitions';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDB, type TestDatabaseInstance } from './initDB';
import { startScriptedChat, userMessage } from './scriptedChat';

describe('ChatConfig.historyLimit', () => {
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

  // A stored conversation of five messages, then one generate() call
  async function texts(historyLimit?: number) {
    const { loft, llm, session } = await startScriptedChat(testDb, [{ text: 'Three.' }], {
      chatConfig: historyLimit === undefined ? undefined : { historyLimit }
    });
    const history = ['First?', 'One.', 'Second?', 'Two.', 'Third?'].map((text, index) => ({
      ...userMessage(text, session.id),
      role: index % 2 ? Type.LLM.UnifiedMessageRole.assistant : Type.LLM.UnifiedMessageRole.user
    }));
    await loft.chat.addMessages(session.id, [], history);

    await loft.chat.generate({ sessionId: session.id });

    return llm.calls[0].messages.map((message) => message.text);
  }

  it('loads only the latest messages into a request', async () => {
    expect(await texts(3)).toEqual(['Second?', 'Two.', 'Third?']);
  });

  it('loads the whole history without it', async () => {
    expect(await texts()).toEqual(['First?', 'One.', 'Second?', 'Two.', 'Third?']);
  });
});
