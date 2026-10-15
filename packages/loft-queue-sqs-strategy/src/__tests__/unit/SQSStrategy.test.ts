import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
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
