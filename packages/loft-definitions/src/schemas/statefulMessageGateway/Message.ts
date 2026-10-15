import { z } from 'zod';

import { UUID } from '../common';
import { ContextRecord } from '../entities';
import { UnifiedMessageRoleEnumSchema } from '../llm';
import { State } from './State';

export enum MessageAction {
  CHAT_APPEND = 'CHAT_APPEND',
  MESSAGE_ARCHIVE = 'MESSAGE_ARCHIVE',
  SESSION_UPDATE = 'SESSION_UPDATE'
}

export const MessageActionEnumSchema = z.nativeEnum(MessageAction);

export const CreateMessage = z.object({
  correlatorId: z.string(),
  action: MessageActionEnumSchema,
  content: z.string().nullable(),
  ctx: ContextRecord,
  role: UnifiedMessageRoleEnumSchema.nullable(),
  author: z.string().nullable(),
  sessionId: UUID,
  llmName: z.string().nullable(),
  manifestName: z.string().nullable()
});

export const Message = CreateMessage.extend({
  id: UUID,
  sequenceId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date()
});

export const MessageWithStates = Message.extend({
  states: z.array(State)
});
