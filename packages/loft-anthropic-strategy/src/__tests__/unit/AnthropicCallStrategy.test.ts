import { Interface, Strategy } from '@moc-global/loft-definitions';
import { describe, expect, it, vi } from 'vitest';

import { AnthropicCallStrategy } from '../../AnthropicCallStrategy';
import { AnthropicLoftStrategy } from '../../AnthropicLoftStrategy';

const REQUEST = { model: 'claude-test', max_tokens: 16, messages: [{ role: 'user', content: 'hello' }] };

describe('AnthropicCallStrategy', () => {
  it('passes the signal to messages.create', async () => {
    const { signal } = new AbortController();
    const create = vi.fn().mockResolvedValue({ id: 'msg-1' });
    const strategy = new AnthropicCallStrategy(
      { apiKey: 'test-key' },
      {} as Strategy.LLM.LlmTokenRateLimiter,
      {} as Strategy.LLM.LlmTokenizer
    );
    (strategy as unknown as { client: unknown }).client = { messages: { create } };

    await expect(strategy.generate(REQUEST, { signal })).resolves.toEqual({ id: 'msg-1' });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-test', stream: false }), { signal });
  });
});

describe('AnthropicLoftStrategy', () => {
  it('forwards the call options to the call manager', async () => {
    const { signal } = new AbortController();
    const call = vi.fn().mockResolvedValue({ llmBody: 'response' });
    const callManager = { call } as unknown as Strategy.CallManager;
    const strategy = new AnthropicLoftStrategy({ llmName: 'anthropic' } as Interface.StrategyArgsFacade, callManager);
    const request: Strategy.LLM.LLMRequest<unknown> = {
      sessionId: 'session-1',
      requestType: Strategy.LLM.LLMRequestType.GENERATE,
      llmName: 'anthropic',
      llmBody: REQUEST
    };

    await expect(strategy.generate(request, { signal })).resolves.toEqual({ llmBody: 'response' });

    expect(call).toHaveBeenCalledWith(request, { signal });
  });
});
