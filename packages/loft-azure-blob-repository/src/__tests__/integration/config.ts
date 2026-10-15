import * as dotenv from 'dotenv';
import * as path from 'path';
import { z } from 'zod';

const envPath = path.join(process.cwd(), '.env.test'); // get .env file from current working directory
dotenv.config({ path: envPath });

const envSchema = z.object({
  AZURE_BLOB_STORAGE_CONTAINER_NAME: z.string(),
  AZURE_BLOB_STORAGE_CONNECTION_STRING: z.string()
});

const config = envSchema.parse(process.env);

export { config };
