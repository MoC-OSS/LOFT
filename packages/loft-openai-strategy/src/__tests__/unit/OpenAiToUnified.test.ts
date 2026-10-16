import type { ChatCompletion } from 'openai/resources/chat/completions';
import { describe, expect, it } from 'vitest';

import { openAiChoiceToUnifiedMessage } from '../../adapters/OpenAiToUnified';

const OPTIONS = { correlatorIds: [], sessionId: 'session-1', manifestName: 'assistant', llmName: 'gpt' };

const choiceWithToolCalls = (toolCalls: unknown[], content: string | null = null) =>
  ({
    index: 0,
    finish_reason: 'tool_calls',
    logprobs: null,
    message: { role: 'assistant', content, refusal: null, tool_calls: toolCalls }
  }) as unknown as ChatCompletion.Choice;

const FUNCTION_CALL = {
  id: 'call_1',
  type: 'function',
  function: { name: 'get_weather', arguments: '{"city":"Kyiv"}' }
};
const CUSTOM_CALL = { id: 'call_2', type: 'custom', custom: { name: 'grammar', input: 'x' } };
const TOOL_CALL_PART = {
  type: 'tool_call',
  method: 'tools/call',
  callId: 'call_1',
  params: { name: 'get_weather', arguments: { city: 'Kyiv' } }
};

describe('openAiChoiceToUnifiedMessage', () => {
  it('maps a function tool call to a tool_call part', () => {
    expect(openAiChoiceToUnifiedMessage(choiceWithToolCalls([FUNCTION_CALL]), OPTIONS).content).toEqual([
      TOOL_CALL_PART
    ]);
  });

  it('skips a custom tool call next to a function call or text', () => {
    expect(openAiChoiceToUnifiedMessage(choiceWithToolCalls([CUSTOM_CALL, FUNCTION_CALL]), OPTIONS).content).toEqual([
      TOOL_CALL_PART
    ]);
    expect(openAiChoiceToUnifiedMessage(choiceWithToolCalls([CUSTOM_CALL], 'Hello'), OPTIONS).content).toEqual([
      { type: 'text', text: 'Hello' }
    ]);
  });

  it('rejects a response that has only custom tool calls instead of returning it empty', () => {
    expect(() => openAiChoiceToUnifiedMessage(choiceWithToolCalls([CUSTOM_CALL]), OPTIONS)).toThrow(
      'OpenAI returned only tool calls of a type other than function; LOFT supports only function tool calls'
    );
  });
});
