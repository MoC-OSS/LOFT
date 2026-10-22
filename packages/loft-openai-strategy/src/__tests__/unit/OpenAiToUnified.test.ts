import type { Strategy } from '@moc-global/loft-definitions';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import { describe, expect, it } from 'vitest';

import { openAiChoiceToUnifiedMessage } from '../../adapters/OpenAiToUnified';
import { AzureOpenAiLoftStrategy } from '../../AzureOpenAiLoftStrategy';
import { OpenAiLoftStrategy } from '../../OpenAiLoftStrategy';

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

const completionWithUsage = (usage: ChatCompletion['usage']): ChatCompletion => ({
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 0,
  model: 'o3-mini',
  choices: [
    {
      index: 0,
      finish_reason: 'stop',
      logprobs: null,
      message: { role: 'assistant', content: 'Hello', refusal: null }
    }
  ],
  usage
});

const USAGE = { prompt_tokens: 10, completion_tokens: 40, total_tokens: 50 };

describe.each([
  ['OpenAiLoftStrategy', OpenAiLoftStrategy],
  ['AzureOpenAiLoftStrategy', AzureOpenAiLoftStrategy]
])('%s usage mapping', (_name, StrategyClass) => {
  const strategy = new StrategyClass({ llmName: 'gpt' }, {} as Strategy.CallManager);
  const toUnified = (response: ChatCompletion) =>
    strategy.formatToUnifiedLLMResponse([], 'session-1', response, 'gpt', 'assistant');

  it('maps reasoning tokens from completion_tokens_details', () => {
    const { usage } = toUnified(completionWithUsage({ ...USAGE, completion_tokens_details: { reasoning_tokens: 25 } }));

    expect(usage).toMatchObject({ inputTokens: 10, outputTokens: 40, totalTokens: 50, reasoningTokens: 25 });
  });

  it('leaves reasoning tokens unset when the response has no completion details', () => {
    expect(toUnified(completionWithUsage(USAGE)).usage.reasoningTokens).toBeUndefined();
    expect(toUnified(completionWithUsage(undefined)).usage.reasoningTokens).toBeUndefined();
  });
});
