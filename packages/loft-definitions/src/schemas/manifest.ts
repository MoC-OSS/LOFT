import { z } from 'zod';

const RECORD_KEY = z.string().regex(/^[^"'\\]*$/, {
  message: 'Key must not contain special characters: ", \', \\, \\u0000, \\u0001, ..., \\u001F.'
});

export const ModelPreset = z.object({}).passthrough();

export const LLMManifestProps = z.object({
  systemMessage: z.string(),
  modelPreset: ModelPreset
});

// "openai": { "systemMessage": "you are", "modelPreset": {...} }
export const LLMManifests = z.record(RECORD_KEY, LLMManifestProps);

// "example_manifest_name": LLMManifest
export const Manifests = z.record(RECORD_KEY, LLMManifests);

export const Prompt = z.record(RECORD_KEY, z.string());

export const LoftManifest = z.object({
  llmManifests: Manifests,
  prompts: z.record(Prompt),
  aiTasks: Manifests
});
