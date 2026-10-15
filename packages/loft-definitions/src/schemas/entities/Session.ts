import { z } from 'zod';

import { UUID } from '../common';
import { ContextRecord } from './ContextRecord';

export const SessionExternalKey = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const CreateSession = z.object({
  ctx: ContextRecord,
  currentLlmName: z.string(),
  currentManifestName: z.string(),
  externalKey: SessionExternalKey,
  focusAgent: z.string().nullish()
});

export const Session = CreateSession.extend({
  id: UUID,
  createdAt: z.date(),
  updatedAt: z.date()
});
