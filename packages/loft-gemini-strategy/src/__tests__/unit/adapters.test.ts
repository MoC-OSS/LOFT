import { Type } from '@moc-global/loft-definitions';
import { imageMessage, mcpTools, PNG_BASE64, singleToolCall, toolCallWithoutCallId } from '@moc-global/loft-test-suite';
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
  it('give each call an id that carries the tool name when Gemini sends none', () => {
    const toolCall = convertGeminiFunctionCallToUnifiedToolCall({ name: 'get_weather', args: { city: 'Kyiv' } });

    expect(toolCall).toEqual({
      type: 'tool_call',
      callId: expect.stringMatching(/^get_weather:::/),
      method: 'tools/call',
      params: { name: 'get_weather', arguments: { city: 'Kyiv' } }
    });
  });

  it('keep the id Gemini gives a call, marked as a Gemini id', () => {
    const toolCall = convertGeminiFunctionCallToUnifiedToolCall(
      { id: 'fc-1', name: 'get_weather', args: { city: 'Kyiv' } },
      'sig-1'
    );

    expect(toolCall).toEqual({
      type: 'tool_call',
      callId: 'fc-1',
      method: 'tools/call',
      _meta: { geminiThoughtSignature: 'sig-1', geminiFunctionCallId: 'fc-1' },
      params: { name: 'get_weather', arguments: { city: 'Kyiv' } }
    });
  });
});

describe('Gemini function call ids in the request', () => {
  // The single tool call conversation, its call made by Gemini with the given id
  const withGeminiId = (id: string): Type.Entity.Message[] => {
    const [user, assistant, tool] = singleToolCall.messages;
    const content = (message: Type.Entity.Message, callId: string) =>
      message.content.map((part) =>
        part.type === 'tool_call'
          ? { ...part, callId, _meta: { geminiFunctionCallId: id } }
          : part.type === 'tool_result'
            ? { ...part, callId }
            : part
      );
    return [user, { ...assistant, content: content(assistant, id) }, { ...tool, content: content(tool, id) }];
  };

  it('sends the Gemini id back on the call and on its response, and names the response by the call', () => {
    const [, model, results] = organizeMessagesForGemini(withGeminiId('fc-1'));

    expect(model.parts?.[0].functionCall).toEqual({ id: 'fc-1', name: 'get_weather', args: { city: 'Kyiv' } });
    expect(results.parts?.[0].functionResponse).toEqual({
      id: 'fc-1',
      name: 'get_weather',
      response: { result: '18°C, cloudy' }
    });
  });

  it('sends no id for a call whose id LOFT made', () => {
    const [, model, results] = organizeMessagesForGemini(singleToolCall.messages);

    expect(model.parts?.[0].functionCall).toEqual({ name: 'get_weather', args: { city: 'Kyiv' } });
    expect(results.parts?.[0].functionResponse).toEqual({
      name: 'get_weather',
      response: { result: '18°C, cloudy' }
    });
  });

  it("sends no id for another provider's call, and names its response by the call", () => {
    const [user, assistant, tool] = singleToolCall.messages;
    const openAiId = (message: Type.Entity.Message) => ({
      ...message,
      content: message.content.map((part) =>
        part.type === 'tool_call' || part.type === 'tool_result' ? { ...part, callId: 'call_abc' } : part
      )
    });

    const [, model, results] = organizeMessagesForGemini([user, openAiId(assistant), openAiId(tool)]);

    expect(model.parts?.[0].functionCall).toEqual({ name: 'get_weather', args: { city: 'Kyiv' } });
    expect(results.parts?.[0].functionResponse).toEqual({
      name: 'get_weather',
      response: { result: '18°C, cloudy' }
    });
  });

  it('names a response without its call after a LOFT callId only, and as unknown otherwise', () => {
    const result = (callId: string): Type.Entity.FullContentPart => ({
      type: 'tool_result',
      callId,
      content: [{ type: 'text', text: 'ok' }]
    });
    const [results] = organizeMessagesForGemini([
      {
        ...singleToolCall.messages[2],
        content: [result('get_weather:::abc'), result('abcd_12345'), result('call_abc')]
      }
    ]);

    expect(results.parts?.map((part) => part.functionResponse?.name)).toEqual(['get_weather', 'unknown', 'unknown']);
  });

  it('answers the latest call with a repeated id', () => {
    const first = withGeminiId('fc-1');
    const second = withGeminiId('fc-1').map((message) => ({
      ...message,
      content: message.content.map((part) =>
        part.type === 'tool_call' ? { ...part, params: { ...part.params, name: 'get_time' } } : part
      )
    }));

    const contents = organizeMessagesForGemini([...first, ...second]);

    expect(contents.map((content) => content.parts?.[0].functionResponse?.name)).toEqual([
      undefined,
      undefined,
      'get_weather',
      undefined,
      undefined,
      'get_time'
    ]);
  });
});
