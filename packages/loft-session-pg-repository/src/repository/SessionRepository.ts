import { Agent, Logger, Repository, Type } from '@moc-global/loft-definitions';
import { inject, injectable } from 'inversify';
import { Kysely, Updateable } from 'kysely';
import { stringify as safeStableStringify } from 'safe-stable-stringify';

import { Database } from '../dbTypes';
import { SESSION_DI_TYPES } from '../SessionDITypes';
import { SessionRepositoryConfig } from './config';
import { FocusStateStorePg } from './FocusStateStorePg';
import { HealthCheckService } from './HealthCheckService';
import { SessionQueries } from './sessionQueries';

@injectable()
export class SessionRepository extends SessionQueries implements Repository.Session {
  private readonly log = new Logger('SessionRepository');
  private _focus?: Agent.FocusStateStore;

  constructor(
    @inject(SESSION_DI_TYPES.SessionRepositoryDatabase) db: Kysely<Database>,
    @inject(SESSION_DI_TYPES.HealthCheckService)
    private readonly healthCheckService: HealthCheckService,
    @inject(SESSION_DI_TYPES.SessionRepositoryConfig)
    config: SessionRepositoryConfig
  ) {
    super(db, config);
  }

  get focus(): Agent.FocusStateStore {
    if (!this._focus) {
      this._focus = new FocusStateStorePg(this.db, this.config.schema);
    }
    return this._focus;
  }

  async create(newSessionData: Type.Entity.CreateSession): Promise<Type.Entity.Session> {
    try {
      let externalKey: string | undefined = undefined;

      if (newSessionData.externalKey) {
        // Check if it's an empty object
        const isEmptyObject =
          Object.keys(newSessionData.externalKey).length === 0 && newSessionData.externalKey.constructor === Object;

        if (!isEmptyObject) {
          externalKey = safeStableStringify(newSessionData.externalKey);
        }
      }

      // Create new session and let the database handle unique constraint violations
      const newSession = await this.db
        .withSchema(this.config.schema)
        .insertInto('session')
        .values({
          ...newSessionData,
          externalKey
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        ...newSession,
        externalKey: newSession.externalKey ? JSON.parse(newSession.externalKey) : {}
      };
    } catch (error: any) {
      this.log.error('Error creating session', error);
      throw error;
    }
  }

  async getById(sessionId: Type.Entity.Session['id']): Promise<Type.Entity.Session> {
    try {
      const session = await this.getByIdQuery(sessionId).executeTakeFirst();

      if (!session) {
        throw new Error(`Session with id ${sessionId} not found`);
      }

      return {
        ...session,
        externalKey: session.externalKey ? JSON.parse(session.externalKey) : {}
      };
    } catch (error) {
      this.log.error('Error retrieving session by id', error);
      throw error;
    }
  }

  async getByExternalKey(externalKey: Type.Entity.Session['externalKey']): Promise<Type.Entity.Session> {
    try {
      const isEmptyObject = Object.keys(externalKey).length === 0 && externalKey.constructor === Object;

      if (isEmptyObject) throw new Error('getByExternalKey() External key cannot be an empty object');

      const externalKeyString = safeStableStringify(externalKey);

      const session = await this.db
        .withSchema(this.config.schema)
        .selectFrom('session')
        .selectAll()
        .where('externalKey', '=', externalKeyString)
        .executeTakeFirst();

      if (!session) {
        throw new Error(`Session with externalKey ${externalKey} not found`);
      }

      return {
        ...session,
        externalKey: session.externalKey ? JSON.parse(session.externalKey) : {}
      };
    } catch (error) {
      this.log.error('Error retrieving session by external key', error);
      throw error;
    }
  }

  async updateById(
    sessionId: Type.Entity.Session['id'],
    sessionPayload: Updateable<Type.Entity.Session>
  ): Promise<Type.Entity.Session> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, externalKey: _externalKey, createdAt: _createdAt, ...sanitizedSessionPayload } = sessionPayload;

      const updatedSession = await this.updateByIdQuery(sessionId, {
        ...sanitizedSessionPayload
      }).executeTakeFirstOrThrow();

      return {
        ...updatedSession,
        externalKey: updatedSession.externalKey ? JSON.parse(updatedSession.externalKey) : {}
      };
    } catch (error) {
      this.log.error('Error updating session', error);
      throw error;
    }
  }

  async deleteById(sessionId: Type.Entity.Session['id']): Promise<void> {
    try {
      const result = await this.deleteByIdQuery(sessionId).executeTakeFirst();

      if (!result || result.numDeletedRows === BigInt(0)) {
        throw new Error(`Session with id ${sessionId} not found`);
      }
    } catch (error) {
      this.log.error('Error deleting session', error);
      throw error;
    }
  }

  async checkHealth(): Promise<boolean> {
    return await this.healthCheckService.check();
  }

  async end(): Promise<void> {
    await this.db.destroy();
  }
}
