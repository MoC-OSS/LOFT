import { Strategy } from '@moc-global/loft-definitions';
import { describe, expect, it, vi } from 'vitest';

import { GeminiCallStrategy } from '../../gemini/GeminiCallStrategy';

describe('GeminiCallStrategy', () => {
  it('passes the signal to generateContent as config.abortSignal', async () => {
    const { signal } = new AbortController();
    const generateContent = vi.fn().mockResolvedValue({ text: 'response' });
    const strategy = new GeminiCallStrategy(
      { mode: 'apikey', apiKey: 'test-key' },
      {} as Strategy.LLM.LlmTokenRateLimiter,
      {} as Strategy.LLM.LlmTokenizer
    );
    (strategy as unknown as { ai: unknown }).ai = { models: { generateContent } };
    const request = {
      model: 'gemini-test',
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      systemInstruction: 'be brief',
      config: { temperature: 0.2 }
    };

    await expect(strategy.generate(request, { signal })).resolves.toEqual({ text: 'response' });

    expect(generateContent).toHaveBeenCalledWith({
      model: 'gemini-test',
      contents: request.contents,
      config: { systemInstruction: 'be brief', temperature: 0.2, abortSignal: signal }
    });
  });
});
