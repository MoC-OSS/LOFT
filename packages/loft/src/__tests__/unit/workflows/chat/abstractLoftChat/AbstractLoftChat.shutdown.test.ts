import 'reflect-metadata';

import { ContextProviderInterface, Interface, Logger, Repository, ShutdownError } from '@moc-global/loft-definitions';
import { beforeAll, describe, expect, it } from 'vitest';

import { AbstractLoftChat } from '../../../../../workflows/chat/AbstractLoftChat';

class TestChat extends AbstractLoftChat {
  constructor(shutdownTimeout?: number) {
    super(
      {} as Repository.Session,
      {} as Repository.ChatHistoryManager,
      {} as ContextProviderInterface,
      {} as Interface.LlmManager
    );
    this.shutdownTimeout = shutdownTimeout;
  }

  run<T>(operationId: string, operation: () => Promise<T>): Promise<T> {
    return this.withOperation(operationId, operation);
  }
}

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

describe('AbstractLoftChat shutdown', () => {
  beforeAll(() => {
    Logger.configure({ logLevel: Interface.LogLevel.NONE });
  });

  it('lets an operation in flight start nested operations after shutdown() began', async () => {
    const chat = new TestChat();
    const { opened, open } = gate();
    const request = chat.run('generate', async () => {
      await opened;
      return chat.run('callAndHandle', async () => 'answer');
    });

    const shutdown = chat.shutdown();
    open();

    await expect(request).resolves.toBe('answer');
    await expect(shutdown).resolves.toBeUndefined();
  });

  it('rejects a call started inside an operation that has ended since', async () => {
    const chat = new TestChat();
    const { opened, open } = gate();
    let late!: Promise<string>;
    await chat.run('generate', async () => {
      // Not awaited, so it outlives the operation
      late = opened.then(() => chat.run('addMessages', async () => 'stored'));
    });

    await chat.shutdown();
    open();

    await expect(late).rejects.toBeInstanceOf(ShutdownError);
  });

  it('rejects a new operation once shutdown() began', async () => {
    const chat = new TestChat();
    await chat.shutdown();

    await expect(chat.run('generate', async () => 'answer')).rejects.toBeInstanceOf(ShutdownError);
  });

  it('waits for the operations in flight', async () => {
    const chat = new TestChat();
    const { opened, open } = gate();
    const steps: string[] = [];
    const request = chat.run('generate', async () => {
      await opened;
      steps.push('request');
    });

    const shutdown = chat.shutdown().then(() => void steps.push('shutdown'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(steps).toEqual([]);
    open();

    await Promise.all([request, shutdown]);
    expect(steps).toEqual(['request', 'shutdown']);
  });

  it('returns after shutdownTimeout when an operation does not end', async () => {
    const chat = new TestChat(20);
    void chat.run('generate', () => new Promise(() => {}));

    await expect(chat.shutdown()).resolves.toBeUndefined();
  });
});
