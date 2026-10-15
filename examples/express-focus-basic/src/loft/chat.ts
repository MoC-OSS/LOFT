import { Chat, Type } from '@moc-global/loft-definitions';

import { MODEL_NAME } from './setup';

export interface ChatResponse {
  sessionId: string;
  response: string;
  orderComplete: boolean;
  focusStatus: {
    filled: Record<string, unknown>;
    missing: string[];
    ready: boolean;
  };
}

export const sendMessage = async (
  chat: Chat.ChatInterface,
  sessionId: string,
  message: string
): Promise<ChatResponse> => {
  const userMsg: Type.Entity.CreateMessage = {
    sessionId,
    content: [{ type: 'text', text: message }],
    role: Type.LLM.UnifiedMessageRole.user,
    author: 'user',
    llmName: MODEL_NAME,
    manifestName: 'pizza-order',
    ctx: {},
    llmIgnore: false
  };

  const result = await chat.generate({
    sessionId,
    directMessages: [userMsg]
  });

  const textContent = result.messages.llmResponse.topChoice.content.find(
    (c): c is Type.Entity.TextContent => c.type === 'text'
  );

  await result.messages.save();

  const focusStatus = result.focusStatus ?? { filled: {}, missing: [], ready: false };

  return {
    sessionId,
    response: textContent?.text ?? '',
    orderComplete: focusStatus.ready,
    focusStatus: { filled: focusStatus.filled, missing: focusStatus.missing, ready: focusStatus.ready }
  };
};
