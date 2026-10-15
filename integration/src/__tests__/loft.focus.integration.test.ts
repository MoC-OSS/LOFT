import 'reflect-metadata';

import { Agent, Type } from '@moc-global/loft-definitions';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDB, type TestDatabaseInstance } from './initDB';
import { SCRIPTED_LLM, startScriptedChat, userMessage } from './scriptedChat';

const ORDER_FOCUS: Agent.Focus = {
  agentName: 'order',
  prompt: 'Collect the pizza order',
  fields: [
    {
      key: 'size',
      type: Agent.FocusFieldType.ENUM,
      values: ['small', 'large'],
      required: true,
      description: 'Pizza size'
    },
    { key: 'address', type: Agent.FocusFieldType.STRING, required: true, description: 'Delivery address' }
  ],
  onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'done' }
};

describe('Focus over several turns', () => {
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

  it('stores fields through the update tool and sends the model only the current Focus prompt', async () => {
    const { loft, llm } = await startScriptedChat(testDb, [
      { toolCalls: [{ name: 'update_order_focus', arguments: { size: 'large' } }] },
      { text: 'Large it is. Where should we deliver?' },
      { toolCalls: [{ name: 'update_order_focus', arguments: { address: '1 Main Street' } }] },
      { text: 'Your order is complete.' }
    ]);
    loft.registerFocus('order', ORDER_FOCUS);
    const session = await loft.chat.createSession({
      currentLlmName: SCRIPTED_LLM,
      currentManifestName: 'test-bot',
      ctx: {},
      focusAgent: 'order'
    });

    const first = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [userMessage('A large pizza please', session.id)]
    });
    await first.messages.save();
    expect(first.focusStatus).toMatchObject({ filled: { size: 'large' }, missing: ['address'], ready: false });

    const second = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [userMessage('To 1 Main Street', session.id)]
    });
    expect(second.focusStatus).toMatchObject({ filled: { size: 'large', address: '1 Main Street' }, ready: true });

    // The stored prompt of turn 1 is left out; the model gets one Focus prompt, with the current status
    const focusPrompts = (call: number) =>
      llm.calls[call].messages.filter(
        (message) => message.role === Type.LLM.UnifiedMessageRole.system && message.text.startsWith('## Focus')
      );
    expect(focusPrompts(2)).toHaveLength(1);
    expect(focusPrompts(2)[0].text).toContain('large');
    // Turn 1's own question and answer are still in the history the model gets
    expect(llm.calls[2].messages.map((message) => message.text)).toContain('A large pizza please');
  });
});
