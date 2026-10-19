import 'reflect-metadata';

import { SessionNotFoundError } from '@moc-global/loft-definitions';
import {
  CamelCasePlugin,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler
} from 'kysely';
import { describe, expect, it } from 'vitest';

import { Database } from '../../dbTypes';
import { HealthCheckService } from '../../repository/HealthCheckService';
import { SessionRepository } from '../../repository/SessionRepository';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

// A database that finds no rows: every query returns an empty result
const db = new Kysely<Database>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (kysely) => new PostgresIntrospector(kysely),
    createQueryCompiler: () => new PostgresQueryCompiler()
  },
  plugins: [new CamelCasePlugin()]
});
const repository = new SessionRepository(db, {} as HealthCheckService, { schema: 'session' });

describe('SessionRepository with a missing session', () => {
  it('getById rejects with SessionNotFoundError', async () => {
    const error = await repository.getById(MISSING_ID).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(SessionNotFoundError);
    expect(error).toMatchObject({ sessionId: MISSING_ID, message: `Session with id ${MISSING_ID} not found` });
  });

  it('getByExternalKey rejects with SessionNotFoundError', async () => {
    const error = await repository.getByExternalKey({ crmId: 'missing' }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(SessionNotFoundError);
    expect(error).toMatchObject({ externalKey: { crmId: 'missing' } });
  });

  it('deleteById rejects with SessionNotFoundError', async () => {
    await expect(repository.deleteById(MISSING_ID)).rejects.toBeInstanceOf(SessionNotFoundError);
  });
});
