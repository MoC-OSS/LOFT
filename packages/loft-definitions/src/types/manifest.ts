import { z } from 'zod';

import { Schema } from '..';

export type ModelPreset = z.infer<typeof Schema.ModelPreset>;
export type LLMManifestProps = z.infer<typeof Schema.LLMManifestProps>;
export type LLMManifests = z.infer<typeof Schema.LLMManifests>;
export type Manifest = z.infer<typeof Schema.Manifests>;
export type LoftManifest = z.infer<typeof Schema.LoftManifest>;
