import { z } from 'zod';

export const CallContext = z.object({
  messageIds: z.array(z.string())
});

export const CallManagerResponse = z.object({
  sessionId: z.string(),
  llmName: z.string(),
  llmBody: z.any(),
  callContext: CallContext,
  priority: z.number()
});
