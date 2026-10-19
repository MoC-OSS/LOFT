import { Strategy, Type } from '@moc-global/loft-definitions';
import { describe, expect, it, vi } from 'vitest';

import { AnthropicLoftStrategy } from '../../AnthropicLoftStrategy';

const message = (role: Type.LLM.UnifiedMessageRole, text: string, id: string): Type.Entity.Message => ({
  id,
  sessionId: 'session-1',
  sequenceId: id,
  ctx: {},
  content: [{ type: 'text', text }],
  role,
  author: role,
  llmName: 'claude',
  manifestName: 'assistant',
  llmIgnore: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z')
});

const formatRequest = (messages: Type.Entity.Message[]) =>
  new AnthropicLoftStrategy({ llmName: 'claude' }, {} as Strategy.CallManager).formatToLLMRequest(
    [],
    'You are a helpful assistant.',
    { model: 'claude-sonnet-5-5', max_tokens: 1000 },
    messages
  );

// BaseLoftChat adds the Focus prompt as a system message with the author 'focus'
const FOCUS_PROMPT = {
  ...message(Type.LLM.UnifiedMessageRole.system, '## Focus\nCollect the pizza order.', 'focus'),
  author: 'focus'
};

describe('AnthropicLoftStrategy', () => {
  it('stops the call manager on stop()', () => {
    const stop = vi.fn();
    const strategy = new AnthropicLoftStrategy({ llmName: 'claude' }, { stop } as unknown as Strategy.CallManager);

    strategy.stop();

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('appends the system messages of the conversation to the system prompt', async () => {
    const request = await formatRequest([
      message(Type.LLM.UnifiedMessageRole.system, 'Context from earlier agents: {"budget":100}', '1'),
      message(Type.LLM.UnifiedMessageRole.user, 'Plan the menu', '2'),
      message(Type.LLM.UnifiedMessageRole.system, 'Collect the delivery address.', '3')
    ]);

    expect(request.system).toBe(
      'You are a helpful assistant.\n\nContext from earlier agents: {"budget":100}\n\nCollect the delivery address.'
    );
    expect(request.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Plan the menu' }] }]);
  });

  describe('a Focus turn without a message from the user', () => {
    it('opens the conversation with a user turn when there is no message', async () => {
      const request = await formatRequest([FOCUS_PROMPT]);

      expect(request.system).toContain('Collect the pizza order.');
      expect(request.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Start.' }] }]);
    });

    it('ends the conversation with a user turn when the last message is from the assistant', async () => {
      const request = await formatRequest([
        message(Type.LLM.UnifiedMessageRole.user, 'Hi', '1'),
        message(Type.LLM.UnifiedMessageRole.assistant, 'Hello! What would you like?', '2'),
        FOCUS_PROMPT
      ]);

      expect(request.messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'text', text: 'Continue.' }] });
      expect(request.messages).toHaveLength(3);
    });

    it('leaves a conversation that ends with the assistant as it is without a Focus prompt', async () => {
      const request = await formatRequest([
        message(Type.LLM.UnifiedMessageRole.user, 'Reply in JSON', '1'),
        message(Type.LLM.UnifiedMessageRole.assistant, '{', '2')
      ]);

      expect(request.messages.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: '{' }] });
    });

    it('adds nothing when the conversation ends with the user', async () => {
      const request = await formatRequest([FOCUS_PROMPT, message(Type.LLM.UnifiedMessageRole.user, 'Large', '1')]);

      expect(request.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Large' }] }]);
    });
  });
});
