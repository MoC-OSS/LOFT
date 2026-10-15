import { testLoftQueue } from '@moc-global/loft-definitions/src/__tests__';
import { describe } from 'vitest';

import { SQSClient, SQSStrategy } from '../..';
import { config } from './config';

// todo! test depends on the .aws/credentials file. Need to find a way to mock the AWS SDK or run the tests in a docker container
const sqsClient = new SQSClient({
  endpoint: config.SQS_ENDPOINT,
  region: config.SQS_REGION
});
const loftQueue = new SQSStrategy(sqsClient, config.QUEUE_URL);

describe('SQS LOFT Queue Integration Test', () => {
  testLoftQueue(loftQueue);
});
