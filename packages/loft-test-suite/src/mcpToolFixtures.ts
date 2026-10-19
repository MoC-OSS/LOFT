import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP tools as `listTools()` returns them, shared by the tool declaration tests of every LLM strategy: a flat tool,
 * one with nested objects, arrays and an enum, and one without a description or properties.
 */
export const mcpTools: ListToolsResult['tools'] = [
  {
    name: 'get_weather',
    description: 'The weather in a city',
    inputSchema: {
      type: 'object',
      properties: { city: { type: 'string', description: 'City name' } },
      required: ['city']
    }
  },
  {
    name: 'book_table',
    description: 'Book a table',
    inputSchema: {
      type: 'object',
      properties: {
        time: { type: 'string' },
        guests: { type: 'integer' },
        seating: { type: 'string', enum: ['inside', 'outside'] },
        dishes: { type: 'array', items: { type: 'string' } },
        contact: {
          type: 'object',
          properties: { phone: { type: 'string' }, vip: { type: 'boolean' } },
          required: ['phone']
        }
      },
      required: ['time', 'guests']
    }
  },
  { name: 'ping', inputSchema: { type: 'object' } }
];
