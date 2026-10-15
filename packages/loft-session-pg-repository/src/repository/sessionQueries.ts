import { injectable } from 'inversify';
import { Kysely } from 'kysely';

import { Database, NewSession, Session, SessionUpdate } from '../dbTypes';
import { SessionRepositoryConfig } from './config';

@injectable()
export abstract class SessionQueries {
  constructor(
    protected readonly db: Kysely<Database>,
    protected readonly config: SessionRepositoryConfig
  ) {}

  createQuery(session: NewSession) {
    return this.db.withSchema(this.config.schema).insertInto('session').values(session).returningAll();
  }

  getByIdQuery(id: Session['id']) {
    return this.db.withSchema(this.config.schema).selectFrom('session').selectAll().where('id', '=', id);
  }

  updateByIdQuery(id: Session['id'], session: SessionUpdate) {
    return this.db
      .withSchema(this.config.schema)
      .updateTable('session')
      .set(session)
      .where('id', '=', id)
      .returningAll();
  }

  deleteByIdQuery(id: Session['id']) {
    return this.db.withSchema(this.config.schema).deleteFrom('session').where('id', '=', id);
  }
}
