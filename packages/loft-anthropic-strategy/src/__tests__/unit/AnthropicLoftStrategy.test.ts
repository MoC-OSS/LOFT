import { Strategy, Type } from '@moc-global/loft-definitions';
import { describe, expect, it, vi } from 'vitest';

import { AnthropicLoftStrategy } from '../../AnthropicLoftStrategy';

describe('AnthropicLoftStrategy', () => {
  it('stops the call manager on stop()', () => {
    const stop = vi.fn();
    const strategy = new AnthropicLoftStrategy({ llmName: 'claude' }, { stop } as unknown as Strategy.CallManager);

    strategy.stop();

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('appends the system messages of the conversation to the system prompt', async () => {
    const strategy = new AnthropicLoftStrategy({ llmName: 'claude' }, {} as Strategy.CallManager);
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

    const request = await strategy.formatToLLMRequest(
      [],
      'You are a helpful assistant.',
      { model: 'claude-sonnet-5-5', max_tokens: 1000 },
      [
        message(Type.LLM.UnifiedMessageRole.system, 'Context from earlier agents: {"budget":100}', '1'),
        message(Type.LLM.UnifiedMessageRole.user, 'Plan the menu', '2'),
        message(Type.LLM.UnifiedMessageRole.system, 'Collect the delivery address.', '3')
      ]
    );

    expect(request.system).toBe(
      'You are a helpful assistant.\n\nContext from earlier agents: {"budget":100}\n\nCollect the delivery address.'
    );
    expect(request.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Plan the menu' }] }]);
  });
});
