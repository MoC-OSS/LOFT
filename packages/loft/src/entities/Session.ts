import { Interface, Logger, Repository, Type } from '@moc-global/loft-definitions';

export class Session implements Interface.FacadeEntity.Session {
  public readonly id: string;
  public readonly externalKey: Type.Entity.Session['externalKey'];
  private _ctx: Record<string, unknown>;
  public currentLlmName: string;
  public currentManifestName: string;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;
  public focusAgent: string | null | undefined;
  private readonly log = new Logger('Session');

  constructor(
    private readonly repository: Repository.Session,
    sessionData: Type.Entity.Session
  ) {
    this.id = sessionData.id;
    this.externalKey = sessionData.externalKey;
    this._ctx = sessionData.ctx || {};
    this.currentLlmName = sessionData.currentLlmName;
    this.currentManifestName = sessionData.currentManifestName;
    this.createdAt = sessionData.createdAt;
    this.updatedAt = sessionData.updatedAt;
    this.focusAgent = sessionData.focusAgent;
  }

  get ctx(): Record<string, unknown> {
    return this._ctx;
  }

  set ctx(value: Interface.FacadeEntity.SessionUpdateData) {
    this._ctx = { ...this._ctx, ...value };
  }

  private prepareUpdatePayload(
    sessionData?: Interface.FacadeEntity.SessionUpdateData
  ): Interface.FacadeEntity.SessionUpdateData {
    return {
      currentLlmName: this.currentLlmName,
      currentManifestName: this.currentManifestName,
      ctx: this._ctx,
      ...sessionData
    };
  }

  private selfOverwrite(session: Type.Entity.Session): void {
    this._ctx = session.ctx;
    this.currentLlmName = session.currentLlmName;
    this.currentManifestName = session.currentManifestName;
    this.focusAgent = session.focusAgent;
  }

  async update(sessionData?: Interface.FacadeEntity.SessionUpdateData): Promise<void> {
    this.log.trace('Updating session', { sessionId: this.id });
    try {
      const dataToUpdate = this.prepareUpdatePayload(sessionData);
      const updatedSession = await this.repository.updateById(this.id, dataToUpdate);
      this.selfOverwrite(updatedSession);
    } catch (error) {
      this.log.error('Error updating session', error, { sessionId: this.id });
      throw error;
    }
  }

  async delete(): Promise<void> {
    await this.repository.deleteById(this.id);
  }
}
