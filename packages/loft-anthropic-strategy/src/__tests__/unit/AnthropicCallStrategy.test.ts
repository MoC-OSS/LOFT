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

  it('sends thinking, and leaves temperature, top_p and top_k out of the request body when they are not set', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'msg-1' });
    const strategy = new AnthropicCallStrategy(
      { apiKey: 'test-key' },
      {} as Strategy.LLM.LlmTokenRateLimiter,
      {} as Strategy.LLM.LlmTokenizer
    );
    (strategy as unknown as { client: unknown }).client = { messages: { create } };

    await strategy.generate({ ...REQUEST, thinking: { type: 'between_tools' } });

    // The SDK sends the body as JSON, so this is what reaches the API
    const body = JSON.parse(JSON.stringify(create.mock.calls[0][0]));
    expect(body.thinking).toEqual({ type: 'between_tools' });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body).not.toHaveProperty('top_k');
  });

  it('sends output_config, service_tier, inference_geo and cache_control from the preset', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'msg-1' });
    const strategy = new AnthropicCallStrategy(
      { apiKey: 'test-key' },
      {} as Strategy.LLM.LlmTokenRateLimiter,
      {} as Strategy.LLM.LlmTokenizer
    );
    (strategy as unknown as { client: unknown }).client = { messages: { create } };
    const fields = {
      output_config: { effort: 'low' },
      service_tier: 'standard_only',
      inference_geo: 'us',
      cache_control: { type: 'ephemeral', ttl: '1h' }
    };

    await strategy.generate({ ...REQUEST, ...fields });

    expect(create.mock.calls[0][0]).toMatchObject(fields);
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
