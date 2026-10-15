import { z } from 'zod';

import { UUID } from '../common';

export enum MessageStatus {
  INCOMING = 'INCOMING',
  START = 'START',
  ACTION_APPLIED = 'ACTION_APPLIED',
  IN_LLM_PROCESS = 'IN_LLM_PROCESS',
  LLM_PROCESSED = 'LLM_PROCESSED',
  DONE = 'DONE',
  FAILED = 'FAILED'
}

export const MessageStatusEnum = z.nativeEnum(MessageStatus);

export const State = z.object({
  id: UUID,
  sequenceId: z.string(),
  status: MessageStatusEnum,
  messageId: UUID,
  createdAt: z.date()
});
