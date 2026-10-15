import 'dotenv/config';

import { z } from 'zod';

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  LOFT_MANIFEST_PATH: z.string().default('manifest/manifest.json'),
  LOFT_MANIFEST_ERROR_PATH: z.string().default('manifest/errors/error.json'),
  LOFT_MANIFEST_CACHE_EXPIRATION: z.string().default('3600000').transform(Number).pipe(z.number().int().positive()),
  LOFT_LOG_LEVEL: z.enum(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', 'NONE']).default('INFO')
});

export const env = envSchema.parse(process.env);
