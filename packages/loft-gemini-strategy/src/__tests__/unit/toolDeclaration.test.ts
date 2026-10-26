import type { Schema } from '@google/genai';
import { describe, expect, it } from 'vitest';

import { createGeminiToolsConfig } from '../../gemini/adapters/toolDeclaration';

// The Gemini schema of one parameter, declared with the given JSON Schema
const parameter = (schema: unknown): Schema | undefined => {
  const { tools } = createGeminiToolsConfig([
    { name: 'tool', inputSchema: { type: 'object', properties: { value: schema as object } } }
  ]);
  return tools?.[0].functionDeclarations[0].parameters?.properties?.value;
};

describe('Gemini tool declarations from JSON Schema', () => {
  it('declares a type list with null as its type, nullable', () => {
    expect(parameter({ type: ['string', 'null'], description: 'A note' })).toEqual({
      type: 'STRING',
      description: 'A note',
      nullable: true
    });
  });

  it('declares a type list of several types as anyOf, each with the keywords of its type', () => {
    expect(
      parameter({ type: ['string', 'integer', 'null'], description: 'An id', minLength: 2, minimum: 1, format: 'x' })
    ).toEqual({
      description: 'An id',
      nullable: true,
      anyOf: [
        { type: 'STRING', minLength: '2', format: 'x' },
        { type: 'INTEGER', minimum: 1, format: 'x' }
      ]
    });
  });

  it('keeps an OpenAPI nullable', () => {
    expect(parameter({ type: 'integer', nullable: true })).toEqual({ type: 'INTEGER', nullable: true });
  });

  it('declares anyOf and oneOf as anyOf, a null branch as nullable', () => {
    expect(parameter({ anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] })).toEqual({
      nullable: true,
      anyOf: [{ type: 'STRING' }, { type: 'NUMBER' }]
    });
    expect(parameter({ oneOf: [{ type: 'boolean' }, { type: 'array', items: { type: 'string' } }] })).toEqual({
      anyOf: [{ type: 'BOOLEAN' }, { type: 'ARRAY', items: { type: 'STRING' } }]
    });
  });

  it('declares anyOf of one type and null as that type, nullable', () => {
    expect(
      parameter({ description: 'When', anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] })
    ).toEqual({ type: 'STRING', format: 'date-time', description: 'When', nullable: true });
  });

  it('keeps the number, length and item constraints', () => {
    expect(parameter({ type: 'number', minimum: 0, maximum: 10.5 })).toEqual({
      type: 'NUMBER',
      minimum: 0,
      maximum: 10.5
    });
    expect(parameter({ type: 'string', minLength: 1, maxLength: 80, pattern: '^[a-z]+$' })).toEqual({
      type: 'STRING',
      minLength: '1',
      maxLength: '80',
      pattern: '^[a-z]+$'
    });
    expect(parameter({ type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 3 })).toEqual({
      type: 'ARRAY',
      items: { type: 'INTEGER' },
      minItems: '1',
      maxItems: '3'
    });
  });

  it('keeps the format, default, title and enum', () => {
    expect(parameter({ type: 'string', title: 'Seating', format: 'enum', enum: ['in', 'out'], default: 'in' })).toEqual(
      { type: 'STRING', title: 'Seating', format: 'enum', enum: ['in', 'out'], default: 'in' }
    );
  });

  it('sends enum values as strings, a null value as nullable', () => {
    expect(parameter({ type: ['string', 'null'], enum: ['a', 'b', null] })).toEqual({
      type: 'STRING',
      nullable: true,
      enum: ['a', 'b']
    });
    expect(parameter({ type: 'integer', enum: [1, 2] })).toEqual({ type: 'INTEGER', enum: ['1', '2'] });
    expect(parameter({ type: 'string', enum: ['a', null] })).toEqual({ type: 'STRING', nullable: true, enum: ['a'] });
  });

  it('converts nested items and properties', () => {
    expect(
      parameter({
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: ['string', 'null'] },
            tags: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'null' }] }, maxItems: 5 }
          },
          required: ['name']
        }
      })
    ).toEqual({
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', nullable: true },
          tags: { type: 'ARRAY', items: { type: 'STRING', nullable: true }, maxItems: '5' }
        },
        required: ['name']
      }
    });
  });

  it('leaves out the keywords Gemini has no field for', () => {
    expect(
      parameter({
        type: 'object',
        properties: { a: { type: 'string', const: 'x', examples: ['x'] } },
        additionalProperties: false,
        $schema: 'http://json-schema.org/draft-07/schema#'
      })
    ).toEqual({ type: 'OBJECT', properties: { a: { type: 'STRING' } } });
  });

  it('declares a parameter without a schema as an empty schema', () => {
    expect(parameter(true)).toEqual({});
  });
});
