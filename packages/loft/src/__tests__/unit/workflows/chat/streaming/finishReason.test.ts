import { Chat } from '@moc-global/loft-definitions';
import { describe, expect, it } from 'vitest';

import { normalizeFinishReason } from '../../../../../workflows/chat/streaming/finishReason';

const table: [string, Chat.ChatFinishReason][] = [
  // OpenAI
  ['stop', 'stop'],
  ['length', 'length'],
  ['content_filter', 'content-filter'],
  ['tool_calls', 'tool-calls'],
  ['function_call', 'tool-calls'],
  // Anthropic
  ['end_turn', 'stop'],
  ['stop_sequence', 'stop'],
  ['max_tokens', 'length'],
  ['model_context_window_exceeded', 'length'],
  ['tool_use', 'tool-calls'],
  ['refusal', 'content-filter'],
  ['pause_turn', 'other'],
  // Gemini
  ['STOP', 'stop'],
  ['MAX_TOKENS', 'length'],
  ['SAFETY', 'content-filter'],
  ['RECITATION', 'content-filter'],
  ['BLOCKLIST', 'content-filter'],
  ['PROHIBITED_CONTENT', 'content-filter'],
  ['SPII', 'content-filter'],
  ['IMAGE_SAFETY', 'content-filter'],
  ['IMAGE_PROHIBITED_CONTENT', 'content-filter'],
  ['IMAGE_RECITATION', 'content-filter'],
  ['LANGUAGE', 'other'],
  ['MALFORMED_FUNCTION_CALL', 'error'],
  ['FINISH_REASON_UNSPECIFIED', 'other'],
  ['OTHER', 'other'],
  ['UNEXPECTED_TOOL_CALL', 'other'],
  // LOFT's own
  ['max_loops_exceeded', 'other'],
  ['interceptor_override', 'other'],
  ['middleware_override', 'other'],
  ['unknown', 'other'],
  // Anything else
  ['', 'other'],
  ['Stop', 'other'],
  ['toString', 'other'],
  ['__proto__', 'other']
];

describe('normalizeFinishReason', () => {
  it.each(table)('%s is %s', (finishReason, reason) => {
    expect(normalizeFinishReason(finishReason, false)).toBe(reason);
  });

  it('a step that had tool calls and stopped counts as tool-calls', () => {
    expect(normalizeFinishReason('STOP', true)).toBe('tool-calls');
    expect(normalizeFinishReason('stop', true)).toBe('tool-calls');
    expect(normalizeFinishReason('end_turn', true)).toBe('tool-calls');
    // Any other reason stays as it is
    expect(normalizeFinishReason('MAX_TOKENS', true)).toBe('length');
    expect(normalizeFinishReason('SAFETY', true)).toBe('content-filter');
    expect(normalizeFinishReason('max_loops_exceeded', true)).toBe('other');
    expect(normalizeFinishReason('tool_calls', true)).toBe('tool-calls');
  });
});
