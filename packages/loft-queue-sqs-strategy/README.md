# @moc-global/loft-queue-sqs-strategy

> **Experimental.** This package is meant for LOFT's queued generation mode, which is not available through the public API yet. You can construct and use the queue, but no public LOFT method sends work through it. It may change in any release.

An AWS SQS implementation of LOFT's queue interface (`Strategy.LoftQueue`): it publishes messages to a queue, consumes them one at a time, or subscribes a worker with [sqs-consumer](https://github.com/bbc/sqs-consumer).

## Install

```bash
npm install @moc-global/loft-queue-sqs-strategy @aws-sdk/client-sqs
```

`@aws-sdk/client-sqs` 3 (from 3.1140.0) and `@moc-global/loft-definitions` are peer dependencies.

## Usage

```typescript
import { SQSClient, SQSStrategy } from '@moc-global/loft-queue-sqs-strategy';

const sqsClient = new SQSClient({ region: 'eu-west-1' });
const queue = new SQSStrategy(sqsClient, 'https://sqs.eu-west-1.amazonaws.com/123456789012/loft-requests');

export async function roundTrip() {
  await queue.publish(JSON.stringify({ hello: 'world' }));
  // Receives one message, deletes it from the queue and returns its body
  return queue.consume();
}
```

## Configuration

`new SQSStrategy(sqsClient, queueUrl, consumerOptions?, publishOptions?)`:

| Argument | What it sets |
| --- | --- |
| `sqsClient` | An `SQSClient`, re-exported from `@aws-sdk/client-sqs` |
| `queueUrl` | The queue URL |
| `consumerOptions` | `sqs-consumer` options for `subscribe()`, such as `pollingWaitTimeMs` or `batchSize` |
| `publishOptions` | Extra `SendMessageCommand` fields for `publish()`, such as `MessageGroupId` for FIFO queues |

## License

[MIT](./LICENSE)
