import { v4 as uuidv4 } from 'uuid';

import { Type } from '../..';
import { MessageAction, MessageStatus } from '../../schemas/statefulMessageGateway';

type PartialMessage = {
  statuses: MessageStatus[];
  action: MessageAction;
  role: Type.LLM.UnifiedMessageRole;
};

type SeedStatus = {
  status: MessageStatus;
  createdAt: Date;
};

export type SeedType = {
  ctx: Record<string, unknown>;
  correlatorId: string;
  content: string;
  role: Type.LLM.UnifiedMessageRole | null;
  author: string;
  action: MessageAction;
  statuses: SeedStatus[];
  createdAt: Date;
  sessionId: string;
  llmName: string;
  manifestName: string;
  updatedAt: Date;
};

const sessionId0 = '4e5508fd-979d-47ad-a56b-e9a604d02f0f';
const sessionId1 = '4e5508fd-979d-47ad-a56b-e9a604d02f1f';
const sessionId2 = '4e5508fd-979d-47ad-a56b-e9a604d02f2f';
const sessionId3 = '4e5508fd-979d-47ad-a56b-e9a604d02f3f';
const sessionId4 = '4e5508fd-979d-47ad-a56b-e9a604d02f4f';

function generateMessage(sessionId: string, partialMessage: PartialMessage, index: number) {
  const { statuses, action, role } = partialMessage;
  const uniqueContent = uuidv4();
  return {
    ctx: {},
    correlatorId: uuidv4(),
    content: `${index}`,
    role,
    author: `Author ${uniqueContent}`,
    action,
    statuses:
      statuses.length === 0
        ? []
        : statuses.map((status) => ({
            // id: uuidv4(),
            status,
            createdAt: new Date()
          })),
    createdAt: new Date(),
    sessionId,
    llmName: `LLM ${uniqueContent}`,
    manifestName: `System ${uniqueContent}`,
    updatedAt: new Date()
  };
}

function generateSessionData(sessionId: string, messagesConfig: PartialMessage[]) {
  return messagesConfig.map((parts, index) => generateMessage(sessionId, parts, index));
}

// completed session with all messages processed (ready to process two new messages )
const session0Messages = generateSessionData(sessionId0, [
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.CHAT_APPEND,
    statuses: [MessageStatus.START, MessageStatus.IN_LLM_PROCESS, MessageStatus.LLM_PROCESSED, MessageStatus.DONE]
  },
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.CHAT_APPEND,
    statuses: [MessageStatus.START, MessageStatus.IN_LLM_PROCESS, MessageStatus.LLM_PROCESSED, MessageStatus.DONE]
  },
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.SESSION_UPDATE,
    statuses: []
  },
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.SESSION_UPDATE,
    statuses: []
  }
]);

const session1Messages = generateSessionData(sessionId1, [
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.CHAT_APPEND,
    statuses: [MessageStatus.START, MessageStatus.IN_LLM_PROCESS, MessageStatus.LLM_PROCESSED, MessageStatus.DONE]
  },
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.CHAT_APPEND,
    statuses: [MessageStatus.START, MessageStatus.IN_LLM_PROCESS, MessageStatus.LLM_PROCESSED, MessageStatus.DONE]
  },
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.CHAT_APPEND,
    statuses: []
  },
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.CHAT_APPEND,
    statuses: []
  }
]);

// completed session with failed message, but ( ready to process one new message )
const session2Messages = generateSessionData(sessionId2, [
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.CHAT_APPEND,
    statuses: [MessageStatus.START, MessageStatus.IN_LLM_PROCESS, MessageStatus.LLM_PROCESSED, MessageStatus.DONE]
  },
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.CHAT_APPEND,
    statuses: [MessageStatus.START, MessageStatus.IN_LLM_PROCESS, MessageStatus.LLM_PROCESSED, MessageStatus.FAILED]
  },
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.CHAT_APPEND,
    statuses: []
  }
]);

// partially completed session but not all messages are processed yet ( NOT ready to process new messages )
const session3Messages = generateSessionData(sessionId3, [
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.CHAT_APPEND,
    statuses: [MessageStatus.START, MessageStatus.IN_LLM_PROCESS, MessageStatus.LLM_PROCESSED, MessageStatus.DONE]
  },
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.CHAT_APPEND,
    statuses: [MessageStatus.START, MessageStatus.IN_LLM_PROCESS, MessageStatus.LLM_PROCESSED]
  },
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.CHAT_APPEND,
    statuses: []
  },
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.CHAT_APPEND,
    statuses: []
  },
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.CHAT_APPEND,
    statuses: []
  }
]);

const session4Messages = generateSessionData(sessionId4, [
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.CHAT_APPEND,
    statuses: []
  },
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.CHAT_APPEND,
    statuses: []
  },
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.SESSION_UPDATE,
    statuses: []
  },
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.SESSION_UPDATE,
    statuses: []
  },
  {
    role: Type.LLM.UnifiedMessageRole.user,
    action: MessageAction.CHAT_APPEND,
    statuses: []
  }
]);

export const seedData = { session0Messages, session1Messages, session2Messages, session3Messages, session4Messages };
