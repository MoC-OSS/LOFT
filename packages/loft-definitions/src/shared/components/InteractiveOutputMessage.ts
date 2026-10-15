import { Interface, Type } from '../..';

export type OneTimeAppendFn = (
  sessionId: Type.Entity.Session['id'],
  message: Type.Entity.CreateMessage
) => Promise<Type.Entity.Message>;

export class InteractiveOutputMessage implements Interface.FacadeEntity.InteractiveOutputMessage {
  sessionId: string;
  ctx: Record<string, any>;
  content: Type.Entity.FullContentPart[];
  role: Type.LLM.UnifiedMessageRole;
  author: string;
  llmName: string;
  manifestName: string;
  llmIgnore: boolean;

  constructor(messageData: Type.Entity.CreateMessage) {
    this.sessionId = messageData.sessionId;
    this.ctx = messageData.ctx ?? {};
    this.content = messageData.content;
    this.role = messageData.role;
    this.author = messageData.author;
    this.llmName = messageData.llmName;
    this.manifestName = messageData.manifestName;
    this.llmIgnore = messageData.llmIgnore;
  }

  //injected append function must have ChatHistory repository, and token to limit double appending
  private appendFn!: (
    sessionId: Type.Entity.Session['id'],
    message: Type.Entity.CreateMessage
  ) => Promise<Type.Entity.Message>;

  public setAppendFn(appendFn: OneTimeAppendFn): void {
    this.appendFn = appendFn;
  }

  public append(): Promise<Type.Entity.Message> {
    if (!this.appendFn) return Promise.reject(new Error('appendFn is not set'));

    // Automatically gather properties excluding methods
    const messageData = Object.fromEntries(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
      Object.entries(this).filter(([key, value]) => typeof value !== 'function')
    ) as Omit<InteractiveOutputMessage, 'append' | 'setAppendFn'>;

    return this.appendFn(this.sessionId, messageData);
  }
}
