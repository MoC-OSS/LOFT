import { z } from 'zod';

/**
 * Base database configuration schema for PostgreSQL migrations
 */
export const DatabaseEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_SSL: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value.toLowerCase() === 'true'),
  DATABASE_SCHEMA_NAME: z.string()
});

// Type inference from schema
export type DatabaseEnvConfig = z.infer<typeof DatabaseEnvSchema>;
