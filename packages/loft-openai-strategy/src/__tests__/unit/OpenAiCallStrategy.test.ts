import { Strategy } from '@moc-global/loft-definitions';
import { describe, expect, it, vi } from 'vitest';

import { OpenAiCallStrategy } from '../../OpenAiCallStrategy';

describe('OpenAiCallStrategy', () => {
  it('passes the signal to chat.completions.create', async () => {
    const { signal } = new AbortController();
    const create = vi.fn().mockResolvedValue({ id: 'chatcmpl-1' });
    const strategy = new OpenAiCallStrategy(
      'test-key',
      {} as Strategy.LLM.LlmTokenRateLimiter,
      {} as Strategy.LLM.LlmTokenizer
    );
    (strategy as unknown as { openAi: unknown }).openAi = { chat: { completions: { create } } };
    const request = { model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] };

    await expect(strategy.generate(request, { signal })).resolves.toEqual({ id: 'chatcmpl-1' });

    expect(create).toHaveBeenCalledWith(request, { signal });
  });
});
