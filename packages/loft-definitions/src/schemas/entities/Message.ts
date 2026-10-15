import { z } from 'zod';

import { UUID } from '../common';
import { UnifiedMessageRoleEnumSchema } from '../llm';
import { FullContentPartSchema } from './ContentPart';
import { ContextRecord } from './ContextRecord';

export const CreateMessage = z.object({
  id: UUID.optional(),
  sessionId: UUID,
  ctx: ContextRecord.default({}),
  content: z.array(FullContentPartSchema).default([]),
  role: UnifiedMessageRoleEnumSchema,
  author: z.string(),
  llmName: z.string(),
  manifestName: z.string(),
  llmIgnore: z.boolean().default(false)
});

export const Message = CreateMessage.extend({
  id: UUID,
  sequenceId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date()
});

export const ChunkedMessage = z.object({
  content: z.array(FullContentPartSchema),
  author: z.string()
});
