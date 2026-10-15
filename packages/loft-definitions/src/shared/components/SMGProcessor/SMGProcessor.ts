import { Chat, Type } from '../../..';
import { ContextInterface } from '../middleware';

export type SMGMessageActionHandlerMap = {
  [key in Type.SMG.MessageAction]: (
    messages: Type.SMG.Message[],
    ctx: ContextInterface,
    messageIds: Type.SMG.Message['id'][],
    correlatorIds: Type.SMG.Message['correlatorId'][]
  ) => Promise<SMGMessageActionReturn[key]>;
};

export interface SMGMessageActionReturn {
  [Type.SMG.MessageAction.CHAT_APPEND]:
    | {
        action: Type.SMG.MessageAction.CHAT_APPEND;
        status: Chat.Status.SUCCESS;
        messageIds: Type.SMG.Message['id'][];
        correlatorIds: Type.SMG.Message['correlatorId'][];
      }
    | {
        action: Type.SMG.MessageAction;
        status: Chat.Status.ERROR;
        error: Error | unknown;
        messageIds: Type.SMG.Message['id'][];
        correlatorIds: Type.SMG.Message['correlatorId'][];
      };
  [Type.SMG.MessageAction.MESSAGE_ARCHIVE]: void;
  [Type.SMG.MessageAction.SESSION_UPDATE]:
    | {
        action: Type.SMG.MessageAction.SESSION_UPDATE;
        status: Chat.Status.SUCCESS;
        messageIds: Type.SMG.Message['id'][];
        correlatorIds: Type.SMG.Message['correlatorId'][];
      }
    | {
        action: Type.SMG.MessageAction;
        status: Chat.Status.ERROR;
        messageIds: Type.SMG.Message['id'][];
        correlatorIds: Type.SMG.Message['correlatorId'][];
        error: Error | unknown;
      };
}

export type SMGMessage<T extends Type.SMG.MessageAction = Type.SMG.MessageAction> = Type.SMG.Message & {
  action: T;
};
