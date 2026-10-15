import { describe, expect, it } from 'vitest';

import { openAiChoiceToUnifiedMessage } from '../../adapters/OpenAiToUnified';

const OPTIONS = { correlatorIds: [], sessionId: 'session-1', manifestName: 'assistant', llmName: 'gpt' };

const choiceWithToolCall = (toolCall: unknown) =>
  ({
    index: 0,
    finish_reason: 'tool_calls',
    logprobs: null,
    message: { role: 'assistant', content: null, refusal: null, tool_calls: [toolCall] }
  }) as any;

describe('openAiChoiceToUnifiedMessage', () => {
  it('maps a function tool call to a tool_call part', () => {
    const message = openAiChoiceToUnifiedMessage(
      choiceWithToolCall({
        id: 'call_1',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"Kyiv"}' }
      }),
      OPTIONS
    );

    expect(message.content).toEqual([
      {
        type: 'tool_call',
        method: 'tools/call',
        callId: 'call_1',
        params: { name: 'get_weather', arguments: { city: 'Kyiv' } }
      }
    ]);
  });

  it('rejects a custom tool call instead of dropping it', () => {
    const choice = choiceWithToolCall({ id: 'call_2', type: 'custom', custom: { name: 'grammar', input: 'x' } });

    expect(() => openAiChoiceToUnifiedMessage(choice, OPTIONS)).toThrow(
      'OpenAI returned a tool call of type "custom"; LOFT supports only function tool calls'
    );
  });
});
