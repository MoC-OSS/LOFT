import { describe, expect, it } from 'vitest';

import { LlmTokenizer } from '../../LlmTokenizer';

describe('LlmTokenizer', () => {
  const tokenizer = new LlmTokenizer();

  it('counts the tokens of a string with a 10% margin, rounded up', () => {
    // "hello world" is two tokens: 2 * 1.1 = 2.2
    expect(tokenizer.calculateTokensFromString('hello world')).toBe(3);
  });

  it('counts nothing for an empty string', () => {
    expect(tokenizer.calculateTokensFromString('')).toBe(0);
  });

  it('grows with the text', () => {
    const short = tokenizer.calculateTokensFromString('The weather in Kyiv.');
    const long = tokenizer.calculateTokensFromString('The weather in Kyiv. '.repeat(20));

    expect(long).toBeGreaterThan(short * 10);
  });
});
