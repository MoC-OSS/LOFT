import type { GenerateContentResponse } from '@google/genai';
import { describe, expect, it } from 'vitest';

import { formatGeminiResponseToUnified } from '../../gemini/adapters/messageResponse';
import { extractToolCallsFromContent } from '../../gemini/adapters/toolRequest';

const OPTIONS = { correlatorIds: [], sessionId: 'session-1', manifestName: 'bot', llmName: 'gemini' };

const responseWith = (parts: object[]) =>
  ({ candidates: [{ content: { role: 'model', parts } }] }) as unknown as GenerateContentResponse;

describe('Gemini thought signatures', () => {
  it('sends each function call back with the signature it came with', () => {
    const { topChoice } = formatGeminiResponseToUnified(
      responseWith([
        { functionCall: { name: 'add', args: { a: 1, b: 2 } }, thoughtSignature: 'sig-1' },
        { functionCall: { name: 'multiply', args: { a: 3, b: 4 } } }
      ]),
      OPTIONS
    );

    expect(extractToolCallsFromContent(topChoice.content)).toEqual([
      { functionCall: { name: 'add', args: { a: 1, b: 2 } }, thoughtSignature: 'sig-1' },
      { functionCall: { name: 'multiply', args: { a: 3, b: 4 } } }
    ]);
  });

  it('keeps the signature of a text answer and leaves thought summaries out of the answer', () => {
    const { topChoice } = formatGeminiResponseToUnified(
      responseWith([
        { text: 'Let me think', thought: true },
        { text: 'The answer is 3', thoughtSignature: 'sig-2' }
      ]),
      OPTIONS
    );

    expect(topChoice.content).toEqual([
      { type: 'text', text: 'The answer is 3', _meta: { geminiThoughtSignature: 'sig-2' } }
    ]);
  });
});
