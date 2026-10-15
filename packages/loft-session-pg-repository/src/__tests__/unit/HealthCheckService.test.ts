import 'reflect-metadata';

import {
  CompiledQuery,
  DatabaseConnection,
  Driver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  QueryResult
} from 'kysely';
import { describe, expect, it } from 'vitest';

import { Database } from '../../dbTypes';
import { HealthCheckService } from '../../repository/HealthCheckService';

// Records the compiled queries and answers each with the given rows
function recordingDb(rows: unknown[] | Error): { db: Kysely<Database>; queries: CompiledQuery[] } {
  const queries: CompiledQuery[] = [];
  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
      queries.push(query);
      if (rows instanceof Error) throw rows;
      return { rows: rows as R[] };
    },
    // eslint-disable-next-line require-yield
    async *streamQuery() {
      throw new Error('not used');
    }
  };
  const driver: Driver = {
    init: async () => {},
    acquireConnection: async () => connection,
    beginTransaction: async () => {},
    commitTransaction: async () => {},
    rollbackTransaction: async () => {},
    releaseConnection: async () => {},
    destroy: async () => {}
  };
  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  });
  return { db, queries };
}

describe('HealthCheckService.check', () => {
  it('binds the schema name as a parameter instead of putting it in the SQL text', async () => {
    const schema = "x' OR '1'='1";
    const { db, queries } = recordingDb([]);

    await new HealthCheckService(db, { schema } as ConstructorParameters<typeof HealthCheckService>[1]).check();

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).not.toContain(schema);
    expect(queries[0].sql).toContain('$1');
    expect(queries[0].parameters).toEqual([schema]);
  });

  it('returns true when the schema exists', async () => {
    const { db } = recordingDb([{ schema_name: 'loft' }]);

    const service = new HealthCheckService(db, { schema: 'loft' } as ConstructorParameters<
      typeof HealthCheckService
    >[1]);

    await expect(service.check()).resolves.toBe(true);
  });

  it('returns false when the schema does not exist', async () => {
    const { db } = recordingDb([]);

    const service = new HealthCheckService(db, { schema: 'loft' } as ConstructorParameters<
      typeof HealthCheckService
    >[1]);

    await expect(service.check()).resolves.toBe(false);
  });

  it('returns false when the query fails', async () => {
    const { db } = recordingDb(new Error('connection refused'));

    const service = new HealthCheckService(db, { schema: 'loft' } as ConstructorParameters<
      typeof HealthCheckService
    >[1]);

    await expect(service.check()).resolves.toBe(false);
  });
});
