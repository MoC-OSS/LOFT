import type Anthropic from '@anthropic-ai/sdk';
import { Interface, Logger } from '@moc-global/loft-definitions';
import { imageMessage, mcpTools, PNG_BASE64, toolCallWithoutCallId } from '@moc-global/loft-test-suite';
import { beforeAll, describe, expect, it } from 'vitest';

import { convertUnifiedMessagesToAnthropicMessages } from '../../adapters/messageRequest';
import { formatAnthropicResponseToUnified } from '../../adapters/messageResponse';
import { convertMcpToolToAnthropicTool, prepareToolChoice } from '../../adapters/toolDeclaration';
import {
  convertAnthropicToolResultToUnifiedToolResult,
  extractToolResultsFromContent,
  extractToolUsesFromContent
} from '../../adapters/toolResponse';

const OPTIONS = { correlatorIds: [], sessionId: 'session-1', manifestName: 'manifest', llmName: 'claude' };

// Shaped like a Messages API response: an answer with a citation, thinking and a tool call
const RESPONSE = {
  id: 'msg_01',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5-5',
  stop_reason: 'tool_use',
  stop_sequence: null,
  content: [
    { type: 'thinking', thinking: 'The user wants the weather.', signature: 'sig' },
    {
      type: 'text',
      text: 'Checking the weather.',
      citations: [
        { type: 'char_location', cited_text: 'Kyiv', document_index: 0, start_char_index: 0, end_char_index: 4 }
      ]
    },
    { type: 'tool_use', id: 'toolu_01', name: 'get_weather', input: { city: 'Kyiv' } }
  ],
  usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 100 }
} as unknown as Anthropic.Message;

beforeAll(() => {
  Logger.configure({ logLevel: Interface.LogLevel.NONE });
});

describe('Anthropic request adapter', () => {
  it('sends base64 and URL images before the text', () => {
    const [user] = convertUnifiedMessagesToAnthropicMessages([imageMessage]);

    expect(user.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_BASE64 } },
      { type: 'image', source: { type: 'url', url: 'https://example.com/cat.jpg' } },
      { type: 'text', text: 'What is in these pictures?' }
    ]);
  });

  it('gives a tool call without a call id an id of its own', () => {
    const [, assistant] = convertUnifiedMessagesToAnthropicMessages(toolCallWithoutCallId);

    expect(assistant.content).toEqual([
      { type: 'tool_use', id: expect.stringMatching(/^tool_/), name: 'get_weather', input: { city: 'Kyiv' } }
    ]);
  });
});

describe('Anthropic tool declarations', () => {
  it('declares each MCP tool with its input schema', () => {
    expect(convertMcpToolToAnthropicTool(mcpTools)).toEqual([
      {
        name: 'get_weather',
        description: 'The weather in a city',
        input_schema: { type: 'object', properties: mcpTools[0].inputSchema.properties, required: ['city'] }
      },
      {
        name: 'book_table',
        description: 'Book a table',
        input_schema: { type: 'object', properties: mcpTools[1].inputSchema.properties, required: ['time', 'guests'] }
      },
      { name: 'ping', description: undefined, input_schema: { type: 'object', properties: {}, required: [] } }
    ]);
  });

  it('declares nothing without tools', () => {
    expect(convertMcpToolToAnthropicTool([])).toEqual([]);
  });

  it('lets the model choose a tool when a choice is asked for', () => {
    expect(prepareToolChoice()).toBeUndefined();
    expect(prepareToolChoice('any')).toEqual({ type: 'auto' });
  });
});

describe('Anthropic response adapter', () => {
  it('turns the answer and the tool call into one assistant message, without the thinking', () => {
    const unified = formatAnthropicResponseToUnified(RESPONSE.content, OPTIONS, RESPONSE);

    expect(unified.topChoice).toMatchObject({
      sessionId: 'session-1',
      role: 'assistant',
      llmName: 'claude',
      manifestName: 'manifest',
      content: [
        { type: 'text', text: 'Checking the weather.' },
        {
          type: 'tool_call',
          callId: 'toolu_01',
          method: 'tools/call',
          params: { name: 'get_weather', arguments: { city: 'Kyiv' } }
        }
      ],
      ctx: { citations: (RESPONSE.content[1] as Anthropic.TextBlock).citations }
    });
    expect(unified.choices).toEqual([unified.topChoice]);
    expect(unified.originalResponse).toBe(RESPONSE);
  });

  it('reports the usage, the cache reads and the stop reason', () => {
    expect(formatAnthropicResponseToUnified(RESPONSE.content, OPTIONS, RESPONSE).usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      cacheTokens: 100,
      model: 'claude-sonnet-5-5',
      finishReason: 'tool_use'
    });
  });

  it('reports zero usage when the response has none, and skips empty text and unknown blocks', () => {
    const bare = {
      ...RESPONSE,
      stop_reason: null,
      usage: undefined,
      content: [
        { type: 'text', text: '' },
        { type: 'server_tool_use', id: 'srvtoolu_01', name: 'web_search', input: {} }
      ]
    } as unknown as Anthropic.Message;

    const unified = formatAnthropicResponseToUnified(bare.content, OPTIONS, bare);

    expect(unified.topChoice.content).toEqual([]);
    expect(unified.topChoice.ctx).toEqual({});
    expect(unified.usage).toMatchObject({ inputTokens: 0, outputTokens: 0, totalTokens: 0, finishReason: undefined });
  });
});

describe('Anthropic tool blocks', () => {
  it('reads the tool calls of a response', () => {
    expect(extractToolUsesFromContent(RESPONSE.content)).toEqual([
      {
        type: 'tool_call',
        callId: 'toolu_01',
        method: 'tools/call',
        params: { name: 'get_weather', arguments: { city: 'Kyiv' } }
      }
    ]);
  });

  it('reads tool results with text or structured content', () => {
    const blocks = [
      { type: 'tool_result', tool_use_id: 'toolu_01', content: '18°C' },
      { type: 'tool_result', tool_use_id: 'toolu_02', content: [{ type: 'text', text: '14:05' }] }
    ] as unknown as Anthropic.ContentBlock[];

    expect(extractToolResultsFromContent(blocks)).toEqual([
      { type: 'tool_result', callId: 'toolu_01', content: [{ type: 'text', text: '18°C' }] },
      { type: 'tool_result', callId: 'toolu_02', content: [{ type: 'text', text: '[{"type":"text","text":"14:05"}]' }] }
    ]);
    expect(convertAnthropicToolResultToUnifiedToolResult(blocks[0])).toMatchObject({ callId: 'toolu_01' });
  });
});
