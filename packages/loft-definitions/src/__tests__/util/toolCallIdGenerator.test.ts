import { describe, expect, test } from 'vitest';

import { generateToolCallId, parseToolNameFromToolCallId } from '../../shared/utils/toolCallIdGenerator';

describe('generateToolCallId', () => {
  test('returns the tool name, the separator and 20 lowercase letters', () => {
    expect(generateToolCallId('get_weather')).toMatch(/^get_weather:::[a-z]{20}$/);
  });

  test('returns a different id on each call', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateToolCallId('search')));

    expect(ids.size).toBe(100);
  });

  test('round-trips through parseToolNameFromToolCallId', () => {
    expect(parseToolNameFromToolCallId(generateToolCallId('search'))).toBe('search');
  });
});

describe('parseToolNameFromToolCallId', () => {
  test('returns the whole id when it has no separator', () => {
    expect(parseToolNameFromToolCallId('call_abc')).toBe('call_abc');
  });

  test('returns unknown when the tool name is empty', () => {
    expect(parseToolNameFromToolCallId(':::abcdefghijklmnopqrst')).toBe('unknown');
  });
});
