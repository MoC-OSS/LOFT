import { Type } from '../..';

export interface State {
  setState(
    sessionId: string,
    messageIds: string[],
    status: Type.SMG.MessageStatus,
    correlatorIds: string[]
  ): Promise<Type.SMG.Message['id'][]>;
}
