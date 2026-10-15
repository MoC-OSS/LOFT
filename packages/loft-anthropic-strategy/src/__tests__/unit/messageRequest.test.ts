import type Anthropic from '@anthropic-ai/sdk';
import { parallelToolCalls, toolCallWithError, toolChainFixtures } from '@moc-global/loft-test-suite';
import { describe, expect, it } from 'vitest';

import { convertUnifiedMessagesToAnthropicMessages } from '../../adapters/messageRequest';

function toolResultBlocks(message: Anthropic.MessageParam): Anthropic.ToolResultBlockParam[] {
  return Array.isArray(message.content)
    ? message.content.filter((block): block is Anthropic.ToolResultBlockParam => block.type === 'tool_result')
    : [];
}

describe('convertUnifiedMessagesToAnthropicMessages with tool calls', () => {
  it.each(toolChainFixtures)('answers every tool call in one user message: $name', (fixture) => {
    const messages = convertUnifiedMessagesToAnthropicMessages(fixture.messages);

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(toolResultBlocks(messages[2]).map((block) => block.tool_use_id)).toEqual(fixture.callIds);
  });

  it('keeps the text and every tool_use block of the assistant message', () => {
    const assistant = convertUnifiedMessagesToAnthropicMessages(parallelToolCalls.messages)[1];

    expect(assistant.content).toEqual([
      { type: 'text', text: 'Checking both.' },
      expect.objectContaining({ type: 'tool_use', id: parallelToolCalls.callIds[0] }),
      expect.objectContaining({ type: 'tool_use', id: parallelToolCalls.callIds[1] })
    ]);
  });

  it('marks a failed tool result as an error and keeps its text', () => {
    const [ok, failed] = toolResultBlocks(convertUnifiedMessagesToAnthropicMessages(toolCallWithError.messages)[2]);

    expect(ok.is_error).toBeUndefined();
    expect(failed).toEqual({
      type: 'tool_result',
      tool_use_id: toolCallWithError.callIds[1],
      content: [{ type: 'text', text: toolCallWithError.errorText }],
      is_error: true
    });
  });
});
