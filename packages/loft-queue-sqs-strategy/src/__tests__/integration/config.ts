import * as dotenv from 'dotenv';
import * as path from 'path';
import { z } from 'zod';

const envPath = path.join(process.cwd(), '.env.test'); // get .env file from current working directory
dotenv.config({ path: envPath });

const envSchema = z.object({
  SQS_ENDPOINT: z.string(),
  SQS_REGION: z.string(),
  QUEUE_NAME: z.string(),
  QUEUE_URL: z.string()
});

const config = envSchema.parse(process.env);

export { config };
