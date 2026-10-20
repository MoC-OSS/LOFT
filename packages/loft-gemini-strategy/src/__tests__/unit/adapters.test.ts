import { imageMessage, mcpTools, PNG_BASE64, toolCallWithoutCallId } from '@moc-global/loft-test-suite';
import { describe, expect, it } from 'vitest';

import { organizeMessagesForGemini } from '../../gemini/adapters/messageRequest';
import { createGeminiToolsConfig } from '../../gemini/adapters/toolDeclaration';
import { convertGeminiFunctionCallToUnifiedToolCall } from '../../gemini/adapters/toolResponse';

describe('Gemini request adapter', () => {
  it('names a function call by its tool when the call has no id', () => {
    const [, model] = organizeMessagesForGemini(toolCallWithoutCallId);

    expect(model).toEqual({
      role: 'model',
      parts: [expect.objectContaining({ functionCall: { name: 'get_weather', args: { city: 'Kyiv' } } })]
    });
  });

  it('sends a base64 image as inlineData and an image URL as fileData, in order with the text', () => {
    const [user] = organizeMessagesForGemini([imageMessage]);

    expect(user.parts).toEqual([
      { text: 'What is in these pictures?' },
      { inlineData: { mimeType: 'image/png', data: PNG_BASE64 } },
      { fileData: { fileUri: 'https://example.com/cat.jpg', mimeType: 'image/jpeg' } }
    ]);
  });
});

describe('Gemini tool declarations', () => {
  it('declares each MCP tool with Gemini schema types, nested objects, arrays and enums', () => {
    expect(createGeminiToolsConfig(mcpTools)).toEqual({
      tools: [
        {
          functionDeclarations: [
            {
              name: 'get_weather',
              description: 'The weather in a city',
              parameters: {
                type: 'OBJECT',
                properties: { city: expect.objectContaining({ type: 'STRING', description: 'City name' }) },
                required: ['city']
              }
            },
            {
              name: 'book_table',
              description: 'Book a table',
              parameters: {
                type: 'OBJECT',
                properties: {
                  time: expect.objectContaining({ type: 'STRING' }),
                  guests: expect.objectContaining({ type: 'INTEGER' }),
                  seating: expect.objectContaining({ type: 'STRING', enum: ['inside', 'outside'] }),
                  dishes: expect.objectContaining({
                    type: 'ARRAY',
                    items: expect.objectContaining({ type: 'STRING' })
                  }),
                  contact: expect.objectContaining({
                    type: 'OBJECT',
                    properties: {
                      phone: expect.objectContaining({ type: 'STRING' }),
                      vip: expect.objectContaining({ type: 'BOOLEAN' })
                    },
                    required: ['phone']
                  })
                },
                required: ['time', 'guests']
              }
            },
            {
              name: 'ping',
              description: '',
              parameters: { type: 'OBJECT', properties: undefined, required: undefined }
            }
          ]
        }
      ]
    });
  });

  it('declares nothing without tools', () => {
    expect(createGeminiToolsConfig([])).toEqual({});
  });
});

describe('Gemini function calls', () => {
  it('give each call an id that carries the tool name, as Gemini sends none', () => {
    const toolCall = convertGeminiFunctionCallToUnifiedToolCall({ name: 'get_weather', args: { city: 'Kyiv' } });

    expect(toolCall).toEqual({
      type: 'tool_call',
      callId: expect.stringMatching(/^get_weather:::/),
      method: 'tools/call',
      params: { name: 'get_weather', arguments: { city: 'Kyiv' } }
    });
  });
});
