import * as dotenv from 'dotenv';
import * as path from 'path';
import { z } from 'zod';

const envPath = path.join(process.cwd(), '.env.test'); // get .env file from current working directory
dotenv.config({ path: envPath });

const envSchema = z.object({
  S3_REGION: z.string(),
  S3_BUCKET_NAME: z.string(),
  S3_ENDPOINT: z.string()
});

const config = envSchema.parse(process.env);

export { config };
