import * as dotenv from 'dotenv';
import * as path from 'path';
import { z } from 'zod';

const envPath = path.join(process.cwd(), '.env.test'); // get .env file from current working directory
dotenv.config({ path: envPath });

export const config = z
  .object({
    DATABASE_NAME: z.string(),
    DATABASE_HOST: z.string(),
    DATABASE_USER: z.string(),
    DATABASE_PASSWORD: z.string(),
    DATABASE_PORT: z.string().transform(Number),
    DATABASE_SESSION_SCHEMA_NAME: z.string()
  })
  .parse(process.env);
