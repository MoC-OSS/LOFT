import 'reflect-metadata';

import { Chat, Interface, Logger, Strategy } from '@moc-global/loft-definitions';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { FocusRegistry } from '../../focus';
import { LOFT } from '../../LOFT';

describe('LOFT.shutdown', () => {
  beforeAll(() => {
    Logger.configure({ logLevel: Interface.LogLevel.NONE });
  });

  it('shuts the tracer down last', async () => {
    const order: string[] = [];
    const chat = { shutdown: vi.fn(async () => void order.push('chat')) } as unknown as Chat.ChatInterface;
    const llmManager = { stop: vi.fn(() => void order.push('llm')) } as unknown as Interface.LlmManager;
    const tracer = {
      shutdownAsync: vi.fn(async () => void order.push('tracer'))
    } as unknown as Strategy.Tracer.TracerFactory;

    await new LOFT(chat, new FocusRegistry(), llmManager, tracer).shutdown();

    expect(order).toEqual(['chat', 'llm', 'tracer']);
  });

  it('completes when the tracer fails to shut down', async () => {
    const chat = { shutdown: vi.fn().mockResolvedValue(undefined) } as unknown as Chat.ChatInterface;
    const tracer = {
      shutdownAsync: vi.fn().mockRejectedValue(new Error('Langfuse is down'))
    } as unknown as Strategy.Tracer.TracerFactory;

    await expect(new LOFT(chat, new FocusRegistry(), undefined, tracer).shutdown()).resolves.toBeUndefined();
  });

  it('shuts the tracer down when stopping the LLM strategies fails', async () => {
    const chat = { shutdown: vi.fn().mockResolvedValue(undefined) } as unknown as Chat.ChatInterface;
    const llmManager = {
      stop: vi.fn(() => {
        throw new Error('timer already cleared');
      })
    } as unknown as Interface.LlmManager;
    const tracer = { shutdownAsync: vi.fn().mockResolvedValue(undefined) } as unknown as Strategy.Tracer.TracerFactory;

    await expect(new LOFT(chat, new FocusRegistry(), llmManager, tracer).shutdown()).resolves.toBeUndefined();
    expect(tracer.shutdownAsync).toHaveBeenCalledTimes(1);
  });

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
