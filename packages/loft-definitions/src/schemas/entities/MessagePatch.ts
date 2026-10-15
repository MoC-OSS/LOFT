import { z } from 'zod';

import { UUID } from '../common';
import { UnifiedMessageRoleEnumSchema } from '../llm';
import { FullContentPartSchema } from './ContentPart';
import { ContextRecord } from './ContextRecord';

export enum MessagePatchAction {
  // ADD_BEFORE = 'ADD_BEFORE',
  PATCH = 'PATCH'
  // ADD_AFTER = 'ADD_AFTER'
}

export const MessagePatchActionEnumSchema = z.nativeEnum(MessagePatchAction);

export const CreateMessagePatch = z.object({
  sessionId: UUID,
  messageId: UUID,
  patchAction: MessagePatchActionEnumSchema,
  ctx: ContextRecord.optional(),
  content: z.array(FullContentPartSchema).optional(),
  role: UnifiedMessageRoleEnumSchema.optional(),
  author: z.string().optional(),
  llmName: z.string().optional(),
  manifestName: z.string().optional(),
  llmIgnore: z.boolean().optional()
});

export const MessagePatch = CreateMessagePatch.extend({
  id: UUID, // not for patching
  sequenceId: z.string(), // not for patching
  createdAt: z.date() // not for patching
});
