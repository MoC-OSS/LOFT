import { Chat } from '@moc-global/loft-definitions';

import { FOCUS_NAME } from './focus-config';
import { MODEL_NAME } from './setup';

export const createSession = async (chat: Chat.ChatInterface): Promise<string> => {
  const session = await chat.createSession({
    currentLlmName: MODEL_NAME,
    currentManifestName: 'pizza-order',
    ctx: {},
    focusAgent: FOCUS_NAME
  });
  return session.id;
};

export const getHistory = async (chat: Chat.ChatInterface, sessionId: string) => {
  return chat.getChatHistory(sessionId);
};
