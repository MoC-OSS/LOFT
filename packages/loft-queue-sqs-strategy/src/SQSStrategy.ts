import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SendMessageCommandInput,
  SQSClient
} from '@aws-sdk/client-sqs';
import { Logger, Strategy } from '@moc-global/loft-definitions';
import { Consumer, ConsumerOptions } from 'sqs-consumer';

const log = new Logger('SQSStrategy');

export class SQSStrategy implements Strategy.LoftQueue {
  private consumer: Consumer | undefined;
  constructor(
    private readonly sqsClient: SQSClient,
    private readonly queueURL: string,
    private readonly consumerOptions?: Partial<ConsumerOptions>,
    private readonly publishOptions?: Partial<SendMessageCommandInput>
  ) {}

  // https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sqs/command/SendMessageCommand/
  async publish(message: string): Promise<void> {
    const input: SendMessageCommandInput = {
      ...this.publishOptions,
      QueueUrl: this.queueURL,
      MessageBody: message
    };
    const command = new SendMessageCommand(input);
    // Awaited so a failed send rejects publish() instead of being lost
    await this.sqsClient.send(command);
  }

  //https://bbc.github.io/sqs-consumer/interfaces/ConsumerOptions.html#pollingWaitTimeMs
  async subscribe(worker: (message: unknown) => Promise<void>): Promise<void> {
    this.consumer = Consumer.create({
      ...this.consumerOptions,
      queueUrl: this.queueURL,
      handleMessage: async (message) => {
        await worker(message.Body);
        // From sqs-consumer 14 a message is deleted only when the handler returns it
        return message;
      },
      sqs: this.sqsClient
    });

    this.consumer.start();

    this.consumer.on('error', (err) => {
      log.error('SQS consumer error', err);
    });

    this.consumer.on('processing_error', (err) => {
      log.error('SQS consumer processing error', err);
    });

    this.consumer.on('timeout_error', (err) => {
      log.error('SQS consumer timeout error', err);
    });
  }
  // https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sqs/command/ReceiveMessageCommand/
  async consume() {
    const result = await this.sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueURL,
        MaxNumberOfMessages: 1
      })
    );

    let resultMessage = undefined;

    if (result.Messages && result.Messages.length > 0) {
      const [message] = result.Messages;
      resultMessage = message.Body;
      await this.sqsClient.send(
        //https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sqs/command/DeleteMessageCommand/
        new DeleteMessageCommand({
          QueueUrl: this.queueURL,
          ReceiptHandle: message.ReceiptHandle
        })
      );
    }

    return resultMessage;
  }
}
