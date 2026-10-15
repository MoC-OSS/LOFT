import Anthropic from '@anthropic-ai/sdk';
import { Type } from '@moc-global/loft-definitions';
import { describe, expect, it } from 'vitest';

import { convertUnifiedMessagesToAnthropicMessages } from '../../adapters/messageRequest';
import { convertAnthropicContentToUnifiedMessage } from '../../adapters/messageResponse';

const OPTIONS = { correlatorIds: [], sessionId: 'session-1', manifestName: 'bot', llmName: 'claude' };

const THINKING = { type: 'thinking', thinking: 'The user wants the weather', signature: 'sig-1' };
const REDACTED = { type: 'redacted_thinking', data: 'opaque' };
const TOOL_USE = { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Kyiv' } };

const message = (role: Type.LLM.UnifiedMessageRole, content: Type.Entity.FullContentPart[]): Type.Entity.Message => ({
  id: `${role}-${Math.random()}`,
  sessionId: 'session-1',
  sequenceId: '1',
  ctx: {},
  content,
  role,
  author: role,
  llmName: 'claude',
  manifestName: 'bot',
  llmIgnore: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z')
});

// The assistant message of a tool loop, as the strategy builds it from a response with thinking
const assistantWithThinking = () =>
  message(
    Type.LLM.UnifiedMessageRole.assistant,
    convertAnthropicContentToUnifiedMessage([THINKING, REDACTED, TOOL_USE] as Anthropic.ContentBlock[], OPTIONS).content
  );

const user = (text: string) => message(Type.LLM.UnifiedMessageRole.user, [{ type: 'text', text }]);
const toolResult = message(Type.LLM.UnifiedMessageRole.tool, [
  { type: 'tool_result', callId: 'toolu_1', content: [{ type: 'text', text: '18°C' }] }
]);

describe('Anthropic thinking blocks', () => {
  it('keeps thinking out of the answer and on the tool call', () => {
    const [toolCall, ...rest] = assistantWithThinking().content;

    expect(rest).toEqual([]);
    expect(toolCall).toMatchObject({
      type: 'tool_call',
      callId: 'toolu_1',
      _meta: { anthropicThinking: [THINKING, REDACTED] }
    });
  });

  it('drops the thinking of an answer without tool calls', () => {
    const { content } = convertAnthropicContentToUnifiedMessage(
      [THINKING, { type: 'text', text: 'Hello', citations: null }] as Anthropic.ContentBlock[],
      OPTIONS
    );

    expect(content).toEqual([{ type: 'text', text: 'Hello' }]);
  });

  it('sends the thinking back first in the tool loop of the current turn', () => {
    const [, assistant] = convertUnifiedMessagesToAnthropicMessages([
      user('Weather in Kyiv?'),
      assistantWithThinking(),
      toolResult
    ]);

    expect(assistant.content).toEqual([THINKING, REDACTED, TOOL_USE]);
  });

  it('leaves the thinking of an earlier turn out', () => {
    const [, assistant] = convertUnifiedMessagesToAnthropicMessages([
      user('Weather in Kyiv?'),
      assistantWithThinking(),
      toolResult,
      message(Type.LLM.UnifiedMessageRole.assistant, [{ type: 'text', text: '18°C in Kyiv' }]),
      user('And tomorrow?')
    ]);

    expect(assistant.content).toEqual([TOOL_USE]);
  });
});
