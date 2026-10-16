import type { GenerateContentResponse } from '@google/genai';
import { describe, expect, it } from 'vitest';

import { formatGeminiResponseToUnified } from '../../gemini/adapters/messageResponse';
import { signUnsignedFunctionCalls, SKIP_THOUGHT_SIGNATURE_VALIDATOR } from '../../gemini/adapters/thoughtSignature';
import { extractToolCallsFromContent } from '../../gemini/adapters/toolRequest';
import { GeminiStream } from '../../gemini/GeminiStream';

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

  it('moves a signature from a part that is not kept to the next kept part', () => {
    const { topChoice } = formatGeminiResponseToUnified(
      responseWith([
        { text: 'Plan the calls', thought: true, thoughtSignature: 'sig-3' },
        { functionCall: { name: 'add', args: { a: 1, b: 2 } } }
      ]),
      OPTIONS
    );

    expect(extractToolCallsFromContent(topChoice.content)).toEqual([
      { functionCall: { name: 'add', args: { a: 1, b: 2 } }, thoughtSignature: 'sig-3' }
    ]);
  });

  it('moves the signature of an empty final part to the last kept part', () => {
    const { topChoice } = formatGeminiResponseToUnified(
      responseWith([{ text: 'The answer is 3' }, { text: '', thoughtSignature: 'sig-4' }]),
      OPTIONS
    );

    expect(topChoice.content).toEqual([
      { type: 'text', text: 'The answer is 3', _meta: { geminiThoughtSignature: 'sig-4' } }
    ]);
  });

  it('signs the first call of a turn without signatures with the stand-in', () => {
    const parts = signUnsignedFunctionCalls([
      { text: 'Calling tools' },
      { functionCall: { name: 'add' } },
      { functionCall: { name: 'multiply' } }
    ]);

    expect(parts).toEqual([
      { text: 'Calling tools' },
      { functionCall: { name: 'add' }, thoughtSignature: SKIP_THOUGHT_SIGNATURE_VALIDATOR },
      { functionCall: { name: 'multiply' } }
    ]);
  });

  it('keeps the signatures of a signed turn', () => {
    const parts = signUnsignedFunctionCalls([
      { functionCall: { name: 'add' }, thoughtSignature: 'sig-5' },
      { functionCall: { name: 'multiply' } }
    ]);

    expect(parts.map((part) => part.thoughtSignature)).toEqual(['sig-5', undefined]);
  });
});

describe('GeminiStream', () => {
  it('leaves thought summaries out of the streamed text', () => {
    const chunk = Buffer.from(
      JSON.stringify(responseWith([{ text: 'Let me think', thought: true }, { text: 'Answer' }]))
    );

    expect(new GeminiStream().formatResponse(chunk).chunk.content).toEqual([{ type: 'text', text: 'Answer' }]);
  });
});
