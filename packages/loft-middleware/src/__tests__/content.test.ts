import type { Type } from '@moc-global/loft-definitions';
import { describe, expect, it } from 'vitest';

import { mapContent, mapStrings, mapToolContent, textOfParts } from '../content';

const upper = (text: string) => text.toUpperCase();

describe('mapStrings', () => {
  it('rewrites every string and key in nested objects and arrays and leaves the original as it was', () => {
    const original = { a: 'one', list: ['two', { b: 'three' }], count: 4, flag: true, nothing: null };
    const mapped = mapStrings(original, upper);
    expect(mapped).toEqual({ A: 'ONE', LIST: ['TWO', { B: 'THREE' }], COUNT: 4, FLAG: true, NOTHING: null });
    expect(original).toEqual({ a: 'one', list: ['two', { b: 'three' }], count: 4, flag: true, nothing: null });
  });

  it('keeps dates and binary data, and turns an error into its name and message', () => {
    const date = new Date('2026-01-01T00:00:00Z');
    const bytes = new Uint8Array([1, 2]);
    const mapped = mapStrings({ secret: date, bytes, error: new TypeError('bad value') }, upper, { keys: false });
    expect(mapped).toEqual({ secret: date, bytes, error: { name: 'TypeError', message: 'BAD VALUE' } });
  });

  it('copies a class instance as its own fields and survives a cycle', () => {
    class Message {
      text = 'hello';
      self?: unknown;
    }
    const message = new Message();
    message.self = message;
    const mapped = mapStrings(message, upper, { keys: false }) as { text: string; self: unknown };
    expect(mapped.text).toBe('HELLO');
    expect(mapped.self).toBe(mapped);
  });
});

describe('mapContent', () => {
  it('rewrites text parts, text resources, tool results and tool arguments, and keeps images', () => {
    const parts: Type.Entity.FullContentPart[] = [
      { type: 'text', text: 'text' },
      { type: 'resource', resource: { uri: 'file://a', text: 'resource' } },
      { type: 'resource', resource: { uri: 'file://b', blob: 'AAAA' } },
      { type: 'image', format: 'base64', data: 'iVBOR', mimeType: 'image/png' } as Type.Entity.FullContentPart,
      { type: 'tool_result', callId: 'c1', content: [{ type: 'text', text: 'result' }], isError: false },
      {
        type: 'tool_call',
        method: 'tools/call',
        callId: 'c1',
        params: { name: 'lookup', arguments: { q: 'query', n: 1 } }
      }
    ];

    const mapped = mapContent(parts, upper);

    expect(mapped).toEqual([
      { type: 'text', text: 'TEXT' },
      { type: 'resource', resource: { uri: 'file://a', text: 'RESOURCE' } },
      { type: 'resource', resource: { uri: 'file://b', blob: 'AAAA' } },
      parts[3],
      { type: 'tool_result', callId: 'c1', content: [{ type: 'text', text: 'RESULT' }], isError: false },
      {
        type: 'tool_call',
        method: 'tools/call',
        callId: 'c1',
        params: { name: 'lookup', arguments: { Q: 'QUERY', N: 1 } }
      }
    ]);
    expect(parts[0]).toEqual({ type: 'text', text: 'text' });
  });

  it('textOfParts joins the text of text parts, resources and tool results', () => {
    expect(
      textOfParts([
        { type: 'text', text: 'a' },
        { type: 'resource', resource: { uri: 'file://a', text: 'b' } },
        { type: 'tool_result', content: [{ type: 'text', text: 'c' }] }
      ])
    ).toBe('a\nb\nc');
  });

  it('mapToolContent rewrites the text of a tool output', () => {
    expect(mapToolContent([{ type: 'text', text: 'out' }], upper)).toEqual([{ type: 'text', text: 'OUT' }]);
  });
});

describe('mapStrings on unusual shapes (review findings)', () => {
  it('replaces a value nested deeper than the limit, so nothing in it passes unmasked', () => {
    let value: unknown = 'secret';
    for (let depth = 0; depth < 70; depth++) value = { inner: value };
    expect(JSON.stringify(mapStrings(value, upper))).not.toContain('secret');
    expect(JSON.stringify(mapStrings(value, upper))).toContain('[truncated]');
  });

  it('walks maps, sets and values with toJSON', () => {
    const withJson = { toJSON: () => ({ id: 'abc' }) };
    expect(mapStrings({ map: new Map([['k', 'v']]), set: new Set(['s']), id: withJson }, upper)).toEqual({
      MAP: [['K', 'V']],
      SET: ['S'],
      ID: { ID: 'ABC' }
    });
  });

  it('rewrites the fields of a resource link, but not its keys', () => {
    expect(mapToolContent([{ type: 'resource_link', uri: 'mailto:jane', name: 'jane' } as never], upper)).toEqual([
      { type: 'RESOURCE_LINK', uri: 'MAILTO:JANE', name: 'JANE' }
    ]);
  });
});

describe('mapStrings on keys and numbers (second review)', () => {
  const hideCard = (text: string) => text.replaceAll('4111111111111111', '[card]');
  const hideMail = (text: string) => text.replaceAll('jane@example.com', '[mail]');

  it('rewrites a number or a bigint when the map changes its text, and keeps it a number otherwise', () => {
    expect(mapStrings({ card: 4111111111111111, big: 4111111111111111n, tokens: 12 }, hideCard)).toEqual({
      card: '[card]',
      big: '[card]',
      tokens: 12
    });
  });

  it('rewrites object keys, such as an e-mail address used as a key', () => {
    expect(mapStrings({ 'jane@example.com': { role: 'owner' } }, hideMail)).toEqual({ '[mail]': { role: 'owner' } });
  });

  it('keeps a __proto__ key a field, so the copy keeps its prototype', () => {
    const parsed: unknown = JSON.parse('{"__proto__": {"polluted": "jane@example.com"}}');
    const mapped = mapStrings(parsed, hideMail) as Record<string, unknown>;
    expect(Object.getPrototypeOf(mapped)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(mapped, '__proto__')?.value).toEqual({ polluted: '[mail]' });
  });
});

describe('resource links in messages (PR review)', () => {
  const link = {
    type: 'resource_link' as const,
    uri: 'mailto:jane@example.com',
    name: 'jane@example.com',
    title: 'Jane',
    description: 'Contact card'
  };

  it('mapContent rewrites the fields of a resource link, but not its keys', () => {
    expect(mapContent([link], upper)).toEqual([
      {
        type: 'RESOURCE_LINK',
        uri: 'MAILTO:JANE@EXAMPLE.COM',
        name: 'JANE@EXAMPLE.COM',
        title: 'JANE',
        description: 'CONTACT CARD'
      }
    ]);
  });

  it('textOfParts gives the uri, name, title and description of a resource link', () => {
    expect(textOfParts([{ type: 'text', text: 'see' }, link])).toBe(
      'see\nmailto:jane@example.com\njane@example.com\nJane\nContact card'
    );
  });
});
