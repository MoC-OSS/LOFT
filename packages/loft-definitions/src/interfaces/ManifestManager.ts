import { ZodSchema } from 'zod';

import { Type } from '..';
import { Prompt } from './prompt';

export interface ManifestManagerConfig {
  // include file name
  manifestPath: string;
  // include file name
  errorPath: string;
  cacheExpirationTime: number;
}

export interface ManifestManager {
  getLlmManifest(manifestName: string, llmName: string): Promise<Type.LLMManifestProps>;
  getAiTaskManifest(manifestName: string, llmName: string): Promise<Type.LLMManifestProps>;
  getPrompt(promptName: string, llmName: string): Promise<Prompt>;
  useLlmManifestSchema(llmName: string, schema: ZodSchema<any>): Promise<void>;
  updateCache(): Promise<void>;
}
