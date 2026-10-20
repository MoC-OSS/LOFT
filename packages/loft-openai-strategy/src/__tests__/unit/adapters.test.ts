import { imageMessage, mcpTools, PNG_BASE64, toolCallWithoutCallId } from '@moc-global/loft-test-suite';
import { describe, expect, it } from 'vitest';

import { mcpToOpenAITool } from '../../adapters/mcpTool';
import { unifiedMessagesToOpenAiMessages } from '../../adapters/UnifiedToOpenAi';

describe('OpenAI request adapter', () => {
  it('sends a base64 image as a data URL and an image URL as it is', () => {
    const [user] = unifiedMessagesToOpenAiMessages([imageMessage]);

    expect(user).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: 'What is in these pictures?' },
        { type: 'image_url', image_url: expect.objectContaining({ url: `data:image/png;base64,${PNG_BASE64}` }) },
        { type: 'image_url', image_url: expect.objectContaining({ url: 'https://example.com/cat.jpg' }) }
      ]
    });
  });

  it('gives a tool call without a call id an id of its own', () => {
    const [, assistant] = unifiedMessagesToOpenAiMessages(toolCallWithoutCallId);

    expect(assistant).toMatchObject({
      role: 'assistant',
      tool_calls: [
        {
          id: expect.stringMatching(/^call_/),
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Kyiv"}' }
        }
      ]
    });
  });
});

describe('OpenAI tool declarations', () => {
  it('declares each MCP tool as a function with its parameters', () => {
    expect(mcpToOpenAITool(mcpTools)).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'The weather in a city',
          parameters: { type: 'object', properties: mcpTools[0].inputSchema.properties, required: ['city'] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'book_table',
          description: 'Book a table',
          parameters: { type: 'object', properties: mcpTools[1].inputSchema.properties, required: ['time', 'guests'] }
        }
      },
      {
        type: 'function',
        function: { name: 'ping', description: undefined, parameters: { type: 'object', properties: {}, required: [] } }
      }
    ]);
  });
});
