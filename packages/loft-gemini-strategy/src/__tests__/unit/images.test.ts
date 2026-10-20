import { Schema, Type } from '@moc-global/loft-definitions';
import { describe, expect, it } from 'vitest';

import { organizeMessagesForGemini } from '../../gemini/adapters/messageRequest';

// A 1x1 transparent PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function userMessage(content: Type.Entity.FullContentPart[]): Type.Entity.Message {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    sessionId: '00000000-0000-4000-8000-000000000002',
    sequenceId: '1',
    ctx: {},
    content,
    role: Schema.LLM.UnifiedMessageRole.user,
    author: 'user',
    llmName: 'gemini',
    manifestName: 'manifest',
    llmIgnore: false,
    createdAt: new Date(0),
    updatedAt: new Date(0)
  };
}

const base64 = (data: string, mimeType?: string): Type.Entity.FullContentPart => ({
  type: 'image',
  format: Schema.Entity.ImageFormat.BASE64,
  data,
  ...(mimeType ? { mimeType } : {})
});
const url = (value: string, extra: Record<string, unknown> = {}): Type.Entity.FullContentPart => ({
  type: 'image',
  format: Schema.Entity.ImageFormat.URL,
  url: value,
  ...extra
});

describe('organizeMessagesForGemini with images', () => {
  it('sends a base64 image inline and an image URL as file data, in order with the text', () => {
    const [user] = organizeMessagesForGemini([
      userMessage([
        { type: 'text', text: 'What is in these pictures?' },
        base64(PNG, 'image/png'),
        url('https://example.com/cat.webp')
      ])
    ]);

    expect(user).toEqual({
      role: 'user',
      parts: [
        { text: 'What is in these pictures?' },
        { inlineData: { mimeType: 'image/png', data: PNG } },
        { fileData: { fileUri: 'https://example.com/cat.webp', mimeType: 'image/webp' } }
      ]
    });
  });

  it.each([
    ['png', PNG, 'image/png'],
    ['jpeg', '/9j/4AAQSkZJRg==', 'image/jpeg'],
    ['gif', 'R0lGODlhAQABAAAAACw=', 'image/gif'],
    ['webp', 'UklGRhoAAABXRUJQ', 'image/webp'],
    ['heic', 'AAAAGGZ0eXBoZWljAAAAAG1pZjFoZWlj', 'image/heic'],
    ['avif', 'AAAAHGZ0eXBhdmlmAAAAAGF2aWZtaWYx', 'image/avif'],
    ['bmp', 'Qk06AAAAAAAAADYAAAA=', 'image/bmp'],
    ['unknown', 'AAAAAAAA', 'image/jpeg']
  ])('finds the MIME type of base64 %s data without one', (_kind, data, mimeType) => {
    const [user] = organizeMessagesForGemini([userMessage([base64(data)])]);

    expect(user.parts).toEqual([{ inlineData: { mimeType, data } }]);
  });

  it.each([
    ['gs://bucket/photo.PNG', 'image/png'],
    ['https://example.com/photo.jpg?size=large', 'image/jpeg'],
    ['https://example.com/photo', 'image/jpeg']
  ])('takes the MIME type of %s from its extension', (fileUri, mimeType) => {
    const [user] = organizeMessagesForGemini([userMessage([url(fileUri)])]);

    expect(user.parts).toEqual([{ fileData: { fileUri, mimeType } }]);
  });

  it('takes the MIME type given on a URL part', () => {
    const [user] = organizeMessagesForGemini([userMessage([url('gs://bucket/upload-42', { mimeType: 'image/png' })])]);

    expect(user.parts).toEqual([{ fileData: { fileUri: 'gs://bucket/upload-42', mimeType: 'image/png' } }]);
  });

  it('sends a base64 data: URL inline, with its MIME type', () => {
    const [user] = organizeMessagesForGemini([userMessage([url(`data:image/png;base64,${PNG}`)])]);

    expect(user.parts).toEqual([{ inlineData: { mimeType: 'image/png', data: PNG } }]);
  });

  it.each([
    'http://intranet.local/files/12345',
    'file:///tmp/photo.png',
    '/uploads/photo.png',
    'data:image/svg+xml,<svg></svg>'
  ])('leaves out %s, which Gemini cannot fetch, and keeps the text', (value) => {
    const [user] = organizeMessagesForGemini([userMessage([{ type: 'text', text: 'Look' }, url(value)])]);

    expect(user.parts).toEqual([{ text: 'Look' }]);
  });

  it('leaves out a message whose only image Gemini cannot fetch', () => {
    const contents = organizeMessagesForGemini([
      userMessage([url('http://intranet.local/files/12345')]),
      userMessage([{ type: 'text', text: 'Hello' }])
    ]);

    expect(contents).toEqual([{ role: 'user', parts: [{ text: 'Hello' }] }]);
  });
});
