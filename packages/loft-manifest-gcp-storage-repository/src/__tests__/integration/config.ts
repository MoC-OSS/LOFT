import * as dotenv from 'dotenv';
import * as path from 'path';
import { z } from 'zod';

const envPath = path.join(process.cwd(), '.env.test'); // get .env file from current working directory
dotenv.config({ path: envPath });

const envSchema = z.object({
  GCP_BUCKET: z.string(),
  GCP_API_ENDPOINT: z.string(),
  GCP_API_PROJECT_ID: z.string()
});

const config = envSchema.parse(process.env);

export { config };
