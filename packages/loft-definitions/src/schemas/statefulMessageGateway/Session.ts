import { z } from 'zod';

import { UUID } from '../common';
import { MessageWithStates } from './Message';

export const Session = z.object({
  id: UUID,
  createdAt: z.date()
});

export const SessionLockStatus = z.object({
  isLocked: z.boolean(),
  reasons: z.object({
    allMessagesFinished: z.boolean(),
    timeoutPassed: z.boolean(),
    lockedByStatus: z.boolean()
  })
});

export const SessionState = z.object({
  sessionId: UUID,
  lockStatus: SessionLockStatus,
  firstOfPendingMessagesId: UUID.optional(),
  totalInputMessages: z.array(MessageWithStates),
  pendingMessagesByAction: z.record(z.string(), z.number()),
  allowProcessing: z.boolean()
});
