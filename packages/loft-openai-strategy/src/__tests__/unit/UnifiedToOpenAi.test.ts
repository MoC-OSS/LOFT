import { Schema, Type } from '@moc-global/loft-definitions';
import { singleToolCall, toolCallWithError, toolChainFixtures } from '@moc-global/loft-test-suite';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionToolMessageParam
} from 'openai/resources/chat/completions';
import { describe, expect, it } from 'vitest';

import { unifiedMessagesToOpenAiMessages } from '../../adapters/UnifiedToOpenAi';

describe('unifiedMessagesToOpenAiMessages with tool calls', () => {
  it.each(toolChainFixtures)('answers every tool call with its own tool message: $name', (fixture) => {
    const messages = unifiedMessagesToOpenAiMessages(fixture.messages);
    const assistant = messages[1] as ChatCompletionAssistantMessageParam;
    const toolMessages = messages.slice(2) as ChatCompletionToolMessageParam[];

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', ...fixture.callIds.map(() => 'tool')]);
    expect(assistant.tool_calls?.map((call) => call.id)).toEqual(fixture.callIds);
    expect(toolMessages.map((m) => m.tool_call_id)).toEqual(fixture.callIds);
  });

  it('passes the failed tool text to the model', () => {
    const failed = unifiedMessagesToOpenAiMessages(toolCallWithError.messages)[3] as ChatCompletionToolMessageParam;

    expect(failed.content).toEqual([{ type: 'text', text: toolCallWithError.errorText }]);
  });

  it('splits a tool message that holds several results into one message per call', () => {
    const [user, assistant, first, second] = toolCallWithError.messages;
    const merged: Type.Entity.Message = { ...first, content: [...first.content, ...second.content] };

    const toolMessages = unifiedMessagesToOpenAiMessages([user, assistant, merged]).slice(2);

    expect(toolMessages.map((m) => (m as ChatCompletionToolMessageParam).tool_call_id)).toEqual(
      toolCallWithError.callIds
    );
  });

  it('sends a result without text as empty content instead of dropping it', () => {
    const [user, assistant, result] = singleToolCall.messages;
    const empty: Type.Entity.Message = {
      ...result,
      role: Schema.LLM.UnifiedMessageRole.tool,
      content: [{ type: 'tool_result', callId: singleToolCall.callIds[0], content: [] }]
    };

    expect(unifiedMessagesToOpenAiMessages([user, assistant, empty])[2]).toEqual({
      role: 'tool',
      content: '',
      tool_call_id: singleToolCall.callIds[0]
    });
  });
});
