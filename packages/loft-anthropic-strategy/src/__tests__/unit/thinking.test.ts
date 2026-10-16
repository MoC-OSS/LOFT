import Anthropic from '@anthropic-ai/sdk';
import { Type } from '@moc-global/loft-definitions';
import { describe, expect, it } from 'vitest';

import { convertUnifiedMessagesToAnthropicMessages } from '../../adapters/messageRequest';
import { convertAnthropicContentToUnifiedMessage } from '../../adapters/messageResponse';
import { ThinkingCache } from '../../adapters/thinking';

const OPTIONS = { correlatorIds: [], sessionId: 'session-1', manifestName: 'bot', llmName: 'claude' };

const THINKING = { type: 'thinking', thinking: 'The user wants the weather', signature: 'sig-1' };
const REDACTED = { type: 'redacted_thinking', data: 'opaque' };
const TOOL_USE = { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Kyiv' } };
const RESPONSE = [THINKING, REDACTED, TOOL_USE] as Anthropic.ContentBlock[];

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

const assistant = () =>
  message(Type.LLM.UnifiedMessageRole.assistant, convertAnthropicContentToUnifiedMessage(RESPONSE, OPTIONS).content);
const user = (text: string) => message(Type.LLM.UnifiedMessageRole.user, [{ type: 'text', text }]);
const toolResult = message(Type.LLM.UnifiedMessageRole.tool, [
  { type: 'tool_result', callId: 'toolu_1', content: [{ type: 'text', text: '18°C' }] }
]);

function cacheWithResponse(): ThinkingCache {
  const cache = new ThinkingCache();
  cache.keep(RESPONSE);
  return cache;
}

describe('Anthropic thinking blocks', () => {
  it('keeps thinking out of the message content', () => {
    expect(assistant().content).toEqual([
      {
        type: 'tool_call',
        callId: 'toolu_1',
        method: 'tools/call',
        params: { name: 'get_weather', arguments: { city: 'Kyiv' } }
      }
    ]);
  });

  it('sends the thinking back first in the tool loop of the current turn', () => {
    const cache = cacheWithResponse();
    const [, request] = convertUnifiedMessagesToAnthropicMessages([user('Weather?'), assistant(), toolResult], (m) =>
      cache.forMessage(m.content)
    );

    expect(request.content).toEqual([THINKING, REDACTED, TOOL_USE]);
  });

  it('leaves the thinking of an earlier turn out', () => {
    const cache = cacheWithResponse();
    const [, request] = convertUnifiedMessagesToAnthropicMessages(
      [user('Weather?'), assistant(), toolResult, user('And tomorrow?')],
      (m) => cache.forMessage(m.content)
    );

    expect(request.content).toEqual([TOOL_USE]);
  });

  it('sends a tool call without thinking when the cache no longer has it', () => {
    const cache = new ThinkingCache(1);
    cache.keep(RESPONSE);
    cache.keep([THINKING, { ...TOOL_USE, id: 'toolu_2' }] as Anthropic.ContentBlock[]);

    expect(cache.forMessage(assistant().content)).toEqual([]);
  });

  it('keeps nothing for a response without tool calls', () => {
    const cache = new ThinkingCache();
    cache.keep([THINKING, { type: 'text', text: 'Hello', citations: null }] as Anthropic.ContentBlock[]);

    expect(cache.forMessage(assistant().content)).toEqual([]);
  });
});
