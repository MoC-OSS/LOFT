import { DeleteMessageCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { describe, expect, it, vi } from 'vitest';

import { SQSStrategy } from '../../SQSStrategy';

const QUEUE_URL = 'https://sqs.eu-west-1.amazonaws.com/000000000000/test-queue';

function strategyWithSend(send: ReturnType<typeof vi.fn>) {
  return new SQSStrategy({ send } as unknown as SQSClient, QUEUE_URL, undefined, { DelaySeconds: 5 });
}

describe('SQSStrategy.publish', () => {
  it('sends the message to the queue with the publish options', async () => {
    const send = vi.fn().mockResolvedValue({ MessageId: 'm-1' });

    await expect(strategyWithSend(send).publish('payload')).resolves.toBeUndefined();

    const command = send.mock.calls[0][0] as SendMessageCommand;
    expect(command).toBeInstanceOf(SendMessageCommand);
    expect(command.input).toEqual({ DelaySeconds: 5, QueueUrl: QUEUE_URL, MessageBody: 'payload' });
  });

  it('rejects when the send fails', async () => {
    const send = vi.fn().mockRejectedValue(new Error('AccessDenied'));

    await expect(strategyWithSend(send).publish('payload')).rejects.toThrow('AccessDenied');
  });
});

describe('SQSStrategy.subscribe', () => {
  // A client that returns one message on the first receive and nothing after it
  function clientWithOneMessage() {
    let received = false;
    const send = vi.fn(async (command: { constructor: { name: string } }) => {
      if (command.constructor.name !== 'ReceiveMessageCommand') return {};
      if (received) return { Messages: [] };
      received = true;
      return { Messages: [{ MessageId: 'm-1', ReceiptHandle: 'receipt-1', Body: 'payload' }] };
    });
    return { send, sentCommands: () => send.mock.calls.map(([command]) => command.constructor.name) };
  }

  async function subscribe(send: ReturnType<typeof vi.fn>, worker: (message: unknown) => Promise<void>) {
    const strategy = new SQSStrategy({ send } as unknown as SQSClient, QUEUE_URL, { pollingWaitTimeMs: 10 });
    await strategy.subscribe(worker);
    return () => (strategy as unknown as { consumer: { stop: () => void } }).consumer.stop();
  }

  it('passes the body to the worker and deletes the message once the worker resolves', async () => {
    const { send, sentCommands } = clientWithOneMessage();
    const worker = vi.fn().mockResolvedValue(undefined);
    const stop = await subscribe(send, worker);

    try {
      await vi.waitFor(() => expect(sentCommands()).toContain('DeleteMessageCommand'));
      expect(worker).toHaveBeenCalledWith('payload');
      const deleteCommand = send.mock.calls
        .map(([command]) => command)
        .find((command): command is DeleteMessageCommand => command instanceof DeleteMessageCommand);
      expect(deleteCommand?.input).toEqual({ QueueUrl: QUEUE_URL, ReceiptHandle: 'receipt-1' });
    } finally {
      stop();
    }
  });

  it('keeps the message in the queue when the worker rejects', async () => {
    const { send, sentCommands } = clientWithOneMessage();
    const worker = vi.fn().mockRejectedValue(new Error('worker failed'));
    const stop = await subscribe(send, worker);

    try {
      await vi.waitFor(() => expect(worker).toHaveBeenCalled());
      // Let the consumer finish handling the message
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(sentCommands()).not.toContain('DeleteMessageCommand');
    } finally {
      stop();
    }
  });
});
