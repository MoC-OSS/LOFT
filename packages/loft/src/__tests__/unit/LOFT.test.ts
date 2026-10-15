import 'reflect-metadata';

import { Chat, Interface } from '@moc-global/loft-definitions';
import { describe, expect, it, vi } from 'vitest';

import { FocusRegistry } from '../../focus';
import { LOFT } from '../../LOFT';

describe('LOFT.shutdown', () => {
  it('stops the LLM strategies after the chat has finished its operations', async () => {
    const order: string[] = [];
    const chat = { shutdown: vi.fn(async () => void order.push('chat')) } as unknown as Chat.ChatInterface;
    const llmManager = { stop: vi.fn(() => void order.push('llm')) } as unknown as Interface.LlmManager;

    await new LOFT(chat, new FocusRegistry(), llmManager).shutdown();

    expect(order).toEqual(['chat', 'llm']);
  });

  it('works without an LlmManager', async () => {
    const chat = { shutdown: vi.fn().mockResolvedValue(undefined) } as unknown as Chat.ChatInterface;

    await expect(new LOFT(chat, new FocusRegistry()).shutdown()).resolves.toBeUndefined();
  });
});
