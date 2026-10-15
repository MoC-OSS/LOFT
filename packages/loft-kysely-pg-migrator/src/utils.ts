import * as dotenv from 'dotenv';
import { existsSync } from 'fs';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

/**
 * Get package version from package.json
 */
export function getPackageVersion(packageDir: string): string {
  const packagePath = path.resolve(packageDir, 'package.json');
  const packageData = fs.readFileSync(packagePath, 'utf-8');
  return JSON.parse(packageData).version;
}

/**
 * Initialize environment configuration with proper priority hierarchy:
 * 1. OS Environment Variables (highest priority)
 * 2. .env file
 * 3. Schema defaults (lowest priority)
 */
export function initEnvConfig<T>(envSchema: z.ZodType<T>, envPath: string = '.env.loft-pg-migrations'): T {
  // Always try to load .env file first (as base)
  const ENV_PATH = path.join(process.cwd(), envPath);
  if (existsSync(ENV_PATH)) {
    console.log(`loading base configuration from ${envPath}`);
    dotenv.config({ path: ENV_PATH });
  }

  // OS env variables will override .env file values (dotenv doesn't override existing process.env)
  console.log('applying OS ENV variable overrides');

  const validatedEnv = envSchema.safeParse(process.env);
  if (validatedEnv.success === false) {
    console.error('Environment configuration is invalid:', validatedEnv.error.issues);
    process.exit(1);
  }

  return validatedEnv.data;
}
