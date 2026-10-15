import 'reflect-metadata';

import { Type } from '@moc-global/loft-definitions';
import { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import { Database } from '../../dbTypes';
import { ChatHistoryRepository } from '../../repository/ChatHistoryRepository';
import { HealthCheckService } from '../../repository/HealthCheckService';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SESSION_ID = '22222222-2222-4222-8222-222222222222';

function message(sessionId: string): Type.Entity.CreateMessage {
  return {
    sessionId,
    ctx: {},
    content: [{ type: 'text', text: 'Hello' }],
    role: Type.LLM.UnifiedMessageRole.user,
    author: 'user',
    llmName: 'test-llm',
    manifestName: 'test-manifest',
    llmIgnore: false
  };
}

describe('ChatHistoryRepository.addMessages', () => {
  it('rejects a message that belongs to another session before writing', async () => {
    const insertInto = vi.fn();
    const db = { withSchema: () => ({ insertInto }) } as unknown as Kysely<Database>;
    const repository = new ChatHistoryRepository(db, { schema: 'chat' }, {} as HealthCheckService);

    await expect(repository.addMessages(SESSION_ID, [message(SESSION_ID), message(OTHER_SESSION_ID)])).rejects.toThrow(
      `Cannot add a message of session ${OTHER_SESSION_ID} to session ${SESSION_ID}`
    );
    expect(insertInto).not.toHaveBeenCalled();
  });
});
