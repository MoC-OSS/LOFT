import 'dotenv/config';

import { z } from 'zod';

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.string().transform(Number).default(5433),
  POSTGRES_USER: z.string().default('loft_example'),
  POSTGRES_PASSWORD: z.string().default('loft_example_pass'),
  POSTGRES_DB: z.string().default('loft_examples'),
  LOFT_SESSION_SCHEMA: z.string().default('loft_session'),
  LOFT_CHAT_HISTORY_SCHEMA: z.string().default('loft_chat_history'),
  LOFT_MANIFEST_PATH: z.string().default('manifest/manifest.json'),
  LOFT_MANIFEST_ERROR_PATH: z.string().default('manifest/errors/error.json'),
  LOFT_MANIFEST_CACHE_EXPIRATION: z.string().transform(Number).default(3600000),
  LOFT_LOG_LEVEL: z.string().default('INFO'),
  PORT: z.string().transform(Number).default(3003)
});

export const env = envSchema.parse(process.env);
