import type { Agent } from '@moc-global/loft-definitions';
import { Kysely } from 'kysely';

export class FocusStateStorePg implements Agent.FocusStateStore {
  constructor(
    private readonly db: Kysely<any>,
    private readonly schema: string
  ) {}

  async get<T = unknown>(sessionId: string, agentName: string, fieldKey: string): Promise<T | undefined> {
    const row = await this.db
      .withSchema(this.schema)
      .selectFrom('focusState')
      .select('value')
      .where('sessionId', '=', sessionId)
      .where('agentName', '=', agentName)
      .where('fieldKey', '=', fieldKey)
      .executeTakeFirst();

    return row?.value as T | undefined;
  }

  async getAll(sessionId: string, agentName: string): Promise<Record<string, unknown>> {
    const rows = await this.db
      .withSchema(this.schema)
      .selectFrom('focusState')
      .select(['fieldKey', 'value'])
      .where('sessionId', '=', sessionId)
      .where('agentName', '=', agentName)
      .execute();

    const result: Record<string, unknown> = {};
    for (const row of rows) {
      result[row.fieldKey] = row.value;
    }
    return result;
  }

  async set<T = unknown>(sessionId: string, agentName: string, fieldKey: string, value: T): Promise<void> {
    const jsonValue = JSON.stringify(value);
    await this.db
      .withSchema(this.schema)
      .insertInto('focusState')
      .values({
        sessionId,
        agentName,
        fieldKey,
        value: jsonValue
      })
      .onConflict((oc) => oc.columns(['sessionId', 'agentName', 'fieldKey']).doUpdateSet({ value: jsonValue }))
      .execute();
  }

  async delete(sessionId: string, agentName: string, fieldKey: string): Promise<void> {
    await this.db
      .withSchema(this.schema)
      .deleteFrom('focusState')
      .where('sessionId', '=', sessionId)
      .where('agentName', '=', agentName)
      .where('fieldKey', '=', fieldKey)
      .execute();
  }

  async clear(sessionId: string, agentName: string): Promise<void> {
    await this.db
      .withSchema(this.schema)
      .deleteFrom('focusState')
      .where('sessionId', '=', sessionId)
      .where('agentName', '=', agentName)
      .execute();
  }

  async clearAll(sessionId: string): Promise<void> {
    await this.db.withSchema(this.schema).deleteFrom('focusState').where('sessionId', '=', sessionId).execute();
  }
}
