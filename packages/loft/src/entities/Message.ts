import { Interface, Repository, Type } from '@moc-global/loft-definitions';

export class Message implements Interface.FacadeEntity.Message {
  public readonly id: string;
  public readonly sessionId: string;
  public readonly sequenceId: string;

  private _ctx!: Record<string, unknown>;

  public content: Type.Entity.FullContentPart[];
  public role: Type.LLM.UnifiedMessageRole;
  public author: string;
  public llmName: string;
  public manifestName: string;
  public llmIgnore: boolean;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(
    private readonly chatHistoryManager: Repository.ChatHistoryManager,
    messageData: Type.Entity.Message
  ) {
    this.id = messageData.id;
    this.sessionId = messageData.sessionId;
    this.sequenceId = messageData.sequenceId;
    this._ctx = messageData.ctx;
    this.content = messageData.content;
    this.role = messageData.role;
    this.author = messageData.author;
    this.llmName = messageData.llmName;
    this.manifestName = messageData.manifestName;
    this.llmIgnore = messageData.llmIgnore;
    this.createdAt = messageData.createdAt;
    this.updatedAt = messageData.updatedAt;
  }

  get ctx(): Record<string, unknown> {
    return this._ctx;
  }

  set ctx(value: Record<string, unknown>) {
    this._ctx = { ...this._ctx, ...value };
  }

  private selfOverwrite(message: Type.Entity.Message): void {
    this._ctx = message.ctx;
    this.content = message.content;
    this.role = message.role;
    this.author = message.author;
    this.llmName = message.llmName;
    this.manifestName = message.manifestName;
    this.llmIgnore = message.llmIgnore;
  }

  private preparePatchPayload(
    patch: Partial<Omit<Type.Entity.CreateMessagePatch, 'messageId'>>
  ): Type.Entity.CreateMessagePatch {
    return {
      sessionId: this.sessionId,
      messageId: this.id,
      patchAction: patch.patchAction ?? Type.Entity.MessagePatchAction.PATCH,
      content: patch.content,
      role: patch.role,
      author: patch.author,
      llmName: patch.llmName,
      manifestName: patch.manifestName,
      llmIgnore: patch.llmIgnore,
      ctx: patch.ctx
    };
  }

  // need for ejecting message fields because getters(_ctx) are not spreadable
  private toMessageEntity(): Type.Entity.Message {
    return {
      id: this.id,
      sessionId: this.sessionId,
      sequenceId: this.sequenceId,
      ctx: this._ctx,
      content: this.content,
      role: this.role,
      author: this.author,
      llmName: this.llmName,
      manifestName: this.manifestName,
      llmIgnore: this.llmIgnore,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  async patch(patch: Partial<Omit<Type.Entity.CreateMessagePatch, 'messageId'>>): Promise<void> {
    const [patchedMessage] = await this.chatHistoryManager.patchMessages(
      this.sessionId,
      [this.toMessageEntity()],
      this.preparePatchPayload(patch)
    );

    this.selfOverwrite(patchedMessage);
  }
}
