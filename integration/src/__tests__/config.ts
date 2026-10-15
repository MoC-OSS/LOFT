import { Interface } from '@moc-global/loft-definitions';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { z } from 'zod';

// Optional: .env.test in the integration directory (see .env.test.example). Every setting has a default, so the
// offline tests need no file. Only the live tests (*.live.test.ts) read the provider and Langfuse keys, and they
// skip themselves when a key is missing.
dotenv.config({ path: path.join(process.cwd(), '.env.test'), quiet: true });

const number = (fallback: number) => z.coerce.number().default(fallback);

export const zodSchema = z.object({
  // Several tests provoke errors on purpose, so LOFT's own error logs are off unless asked for
  LOFT_LOG_LEVEL: z.enum(Object.keys(Interface.LogLevel) as [keyof typeof Interface.LogLevel]).default('FATAL'),

  // The URL of a PostgreSQL server to test against, such as the one docker-compose.dev.yml starts (its user,
  // password and database are set there). Without it every test file starts its own in-process PGlite.
  LOFT_TEST_DATABASE_URL: z.string().url().optional(),

  LOFT_SESSION_DATABASE_SCHEMA_NAME: z.string().default('loft_session'),
  LOFT_CHAT_HISTORY_DATABASE_SCHEMA_NAME: z.string().default('loft_chat_history'),

  LOFT_MANIFEST_PATH: z.string().default('manifest/manifest.json'),
  LOFT_MANIFEST_ERROR_PATH: z.string().default('manifest/errors/error.json'),
  LOFT_MANIFEST_CACHE_EXPIRATION: number(60000),

  // Rate limits and retries of the live provider strategies
  LOFT_OPENAI_CALL_STRATEGY_NEW_TOKENS_PER_SECOND: number(50000),
  LOFT_OPENAI_CALL_STRATEGY_NEW_REQUESTS_PER_SECOND: number(100),
  LOFT_OPENAI_CALL_STRATEGY_MAX_REQUESTS: number(500),
  LOFT_OPENAI_CALL_STRATEGY_MAX_TOKENS: number(2000000),
  LOFT_OPENAI_CALL_STRATEGY_MAX_AWAIT_SECONDS: number(300),
  LOFT_OPENAI_CALL_MANAGER_HIGH_PRIORITY_TASKS_LIMIT: number(10),
  LOFT_OPENAI_CALL_MANAGER_RETRY_DELAY: number(1000),
  LOFT_OPENAI_CALL_MANAGER_RETRY_ATTEMPTS_LIMIT: number(3),

  // Live tests only
  LOFT_OPENAI_API_KEY: z.string().optional(),
  LOFT_ANTHROPIC_API_KEY: z.string().optional(),
  LOFT_GEMINI_VERTEX_PROJECT: z.string().optional(),
  LOFT_GEMINI_VERTEX_LOCATION: z.string().default('us-central1'),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_HOST: z.string().optional()
});

export const env = zodSchema.parse(process.env);

type LiveKey =
  | 'LOFT_OPENAI_API_KEY'
  | 'LOFT_ANTHROPIC_API_KEY'
  | 'LOFT_GEMINI_VERTEX_PROJECT'
  | 'LANGFUSE_SECRET_KEY'
  | 'LANGFUSE_PUBLIC_KEY'
  | 'LANGFUSE_HOST';

/** True when every key is set; live tests use it with describe.runIf. */
export function hasKeys(...keys: LiveKey[]): boolean {
  return keys.every((key) => Boolean(env[key]));
}

/** The key's value; throws when it is missing, so a live helper called without its key fails clearly. */
export function requireKey(key: LiveKey): string {
  const value = env[key];
  if (!value) throw new Error(`Set ${key} in integration/.env.test to run this live test`);
  return value;
}
