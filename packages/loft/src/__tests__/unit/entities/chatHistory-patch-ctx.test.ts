import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { Repository, Type } from '@moc-global/loft-definitions';
import { describe, expect, it, vi } from 'vitest';

import { ChatHistory } from '../../../entities/ChatHistory';
import { Message } from '../../../entities/Message';
import { ChatHistoryManager } from '../../../managers/ChatHistoryManager';

// Runs the real ChatHistoryManager and patch helper; only the repositories are mocked.
// ChatHistory passes Message instances, whose ctx is a getter that object spread does not copy.
describe('ChatHistory.patchMessages with the real ChatHistoryManager', () => {
  const sessionId = randomUUID();

  const createMessage = (ctx: Record<string, unknown>): Type.Entity.Message => ({
    id: randomUUID(),
    sessionId,
    sequenceId: '1',
    ctx,
    content: [{ type: 'text', text: 'Original' }],
    role: Type.LLM.UnifiedMessageRole.user,
    author: 'user',
    llmName: 'test-llm',
    manifestName: 'test-manifest',
    llmIgnore: false,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-01T10:00:00Z')
  });

  const createManager = (patches: Type.Entity.MessagePatch[]) => {
    const chatHistoryRepository = {
      addMessages: vi.fn(),
      getMessages: vi.fn(),
      checkHealth: vi.fn(),
      end: vi.fn()
    } as unknown as Repository.ChatHistory;
    const patcherRepository = {
      patchMessages: vi.fn().mockResolvedValue(patches),
      getPatches: vi.fn(),
      checkHealth: vi.fn(),
      end: vi.fn()
    } as unknown as Repository.ChatHistoryPatcher;
    return new ChatHistoryManager(chatHistoryRepository, patcherRepository);
  };

  const contentPatch = (messageId: string): Type.Entity.MessagePatch => ({
    id: randomUUID(),
    sessionId,
    messageId,
    patchAction: Type.Entity.MessagePatchAction.PATCH,
    sequenceId: '2',
    createdAt: new Date('2026-10-02T10:00:00Z'),
    content: [{ type: 'text', text: 'Patched' }]
  });

  it('keeps the ctx of a message when the patch does not change ctx', async () => {
    const message = createMessage({ orderId: 'o-1001', channel: 'web' });
    const manager = createManager([contentPatch(message.id)]);
    const chatHistory = new ChatHistory(sessionId, manager, [message]);

    await chatHistory.patchMessages([message.id], {
      content: [{ type: 'text', text: 'Patched' }]
    } as Type.Entity.MessagePatch);

    expect(chatHistory.messages[0].content).toEqual([{ type: 'text', text: 'Patched' }]);
    expect(chatHistory.messages[0].ctx).toEqual({ orderId: 'o-1001', channel: 'web' });
  });

  it('returns plain message entities when given Message instances', async () => {
    const data = createMessage({ orderId: 'o-1001' });
    const manager = createManager([contentPatch(data.id)]);

    const [patched] = await manager.patchMessages(sessionId, [new Message(manager, data)], {
      content: [{ type: 'text', text: 'Patched' }]
    });

    expect(patched).toEqual({ ...data, content: [{ type: 'text', text: 'Patched' }] });
    expect(Object.keys(patched).sort()).toEqual(Object.keys(data).sort());
  });
});
