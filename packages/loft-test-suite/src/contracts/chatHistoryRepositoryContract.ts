import { randomUUID } from 'node:crypto';

import { Repository, Type } from '@moc-global/loft-definitions';
import { describe, expect, it } from 'vitest';

function createMessage(
  sessionId: string,
  role: Type.LLM.UnifiedMessageRole,
  content: Type.Entity.FullContentPart[],
  overrides: Partial<Type.Entity.CreateMessage> = {}
): Type.Entity.CreateMessage {
  return {
    sessionId,
    ctx: {},
    content,
    role,
    author: role,
    llmName: 'test-llm',
    manifestName: 'test-manifest',
    llmIgnore: false,
    ...overrides
  };
}

const text = (value: string): Type.Entity.FullContentPart => ({ type: 'text', text: value });

/**
 * Reusable test suite for ChatHistory repository implementations.
 *
 * @param target ChatHistory repository instance to test, or a function that returns it once the tests run (when the
 * repository is created in a beforeAll hook)
 */
export function testChatHistoryRepository(target: Repository.ChatHistory | (() => Repository.ChatHistory)) {
  const repository = () => (typeof target === 'function' ? target() : target);

  describe('ChatHistory repository contract', () => {
    it('reports a healthy connection', async () => {
      expect(await repository().checkHealth()).toBe(true);
    });

    it('stores messages and returns them with their ids', async () => {
      const sessionId = randomUUID();

      const stored = await repository().addMessages(sessionId, [
        createMessage(sessionId, Type.LLM.UnifiedMessageRole.user, [text('Hello')])
      ]);

      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ sessionId, role: 'user', content: [text('Hello')], llmIgnore: false });
      expect(stored[0].id).toEqual(expect.any(String));
    });

    it('keeps the id a message was created with', async () => {
      const sessionId = randomUUID();
      const id = randomUUID();

      const [stored] = await repository().addMessages(sessionId, [
        createMessage(sessionId, Type.LLM.UnifiedMessageRole.user, [text('Hello')], { id })
      ]);

      expect(stored.id).toBe(id);
    });

    it('returns a session’s messages in the order they were added', async () => {
      const sessionId = randomUUID();
      await repository().addMessages(sessionId, [
        createMessage(sessionId, Type.LLM.UnifiedMessageRole.user, [text('first')]),
        createMessage(sessionId, Type.LLM.UnifiedMessageRole.assistant, [text('second')])
      ]);
      await repository().addMessages(sessionId, [
        createMessage(sessionId, Type.LLM.UnifiedMessageRole.user, [text('third')])
      ]);

      const messages = await repository().getMessages(sessionId);

      expect(messages.map((message) => message.content)).toEqual([[text('first')], [text('second')], [text('third')]]);
    });

    it('keeps the messages of each session apart', async () => {
      const first = randomUUID();
      const second = randomUUID();
      await repository().addMessages(first, [createMessage(first, Type.LLM.UnifiedMessageRole.user, [text('A')])]);
      await repository().addMessages(second, [createMessage(second, Type.LLM.UnifiedMessageRole.user, [text('B')])]);

      expect((await repository().getMessages(first)).map((message) => message.content)).toEqual([[text('A')]]);
      expect(await repository().getMessages(randomUUID())).toEqual([]);
    });

    it('stores tool calls, tool results, the context and llmIgnore as they were given', async () => {
      const sessionId = randomUUID();
      const toolCall: Type.Entity.FullContentPart = {
        type: 'tool_call',
        method: 'tools/call',
        callId: 'get_weather:::a1',
        params: { name: 'get_weather', arguments: { city: 'Kyiv', nested_key: { camelCase: true } } }
      };
      const toolResult: Type.Entity.FullContentPart = {
        type: 'tool_result',
        callId: 'get_weather:::a1',
        content: [{ type: 'text', text: '18°C' }],
        isError: false
      };
      await repository().addMessages(sessionId, [
        createMessage(sessionId, Type.LLM.UnifiedMessageRole.assistant, [toolCall], {
          ctx: { snake_case: 1, camelCase: { inner_key: 'kept' } }
        }),
        createMessage(sessionId, Type.LLM.UnifiedMessageRole.tool, [toolResult], { llmIgnore: true })
      ]);

      const [call, result] = await repository().getMessages(sessionId);

      expect(call.content).toEqual([toolCall]);
      expect(call.ctx).toEqual({ snake_case: 1, camelCase: { inner_key: 'kept' } });
      expect(result).toMatchObject({ role: 'tool', content: [toolResult], llmIgnore: true });
    });

    it('rejects a message of another session without storing any', async () => {
      const sessionId = randomUUID();
      const other = randomUUID();

      await expect(
        repository().addMessages(sessionId, [
          createMessage(sessionId, Type.LLM.UnifiedMessageRole.user, [text('mine')]),
          createMessage(other, Type.LLM.UnifiedMessageRole.user, [text('theirs')])
        ])
      ).rejects.toThrow();

      expect(await repository().getMessages(sessionId)).toEqual([]);
      expect(await repository().getMessages(other)).toEqual([]);
    });
  });
}
