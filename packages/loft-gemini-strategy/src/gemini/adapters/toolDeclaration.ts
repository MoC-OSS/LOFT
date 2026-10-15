import type { FunctionDeclaration, Schema, Type } from '@google/genai';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Converts JSON Schema type to Gemini Type enum value
 */
function jsonSchemaTypeToGeminiType(type: string | undefined): Type | undefined {
  if (!type) return undefined;

  const typeMap: Record<string, Type> = {
    string: 'STRING' as Type,
    number: 'NUMBER' as Type,
    integer: 'INTEGER' as Type,
    boolean: 'BOOLEAN' as Type,
    array: 'ARRAY' as Type,
    object: 'OBJECT' as Type
  };

  return typeMap[type.toLowerCase()];
}

/**
 * Converts JSON Schema properties to Gemini Schema properties
 */
function convertProperties(properties: Record<string, any> | undefined): Record<string, Schema> | undefined {
  if (!properties) return undefined;

  const result: Record<string, Schema> = {};

  for (const [key, value] of Object.entries(properties)) {
    result[key] = {
      type: jsonSchemaTypeToGeminiType(value.type),
      description: value.description,
      enum: value.enum,
      items: value.items ? convertProperties({ item: value.items })?.item : undefined,
      properties: value.properties ? convertProperties(value.properties) : undefined,
      required: value.required
    };
  }

  return result;
}

/**
 * Converts MCP tools to Gemini functionDeclarations format
 */
function convertMcpToolsToGeminiFunctionDeclarations(mcpTools: ListToolsResult['tools']): FunctionDeclaration[] {
  if (!mcpTools || mcpTools.length === 0) {
    return [];
  }

  return mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    parameters: {
      type: 'OBJECT' as Type,
      properties: convertProperties(tool.inputSchema.properties as Record<string, any>),
      required: tool.inputSchema.required as string[] | undefined
    }
  }));
}

/**
 * Wraps function declarations in the Gemini tools config format
 */
export function createGeminiToolsConfig(mcpTools: ListToolsResult['tools']): {
  tools?: Array<{ functionDeclarations: FunctionDeclaration[] }>;
} {
  const functionDeclarations = convertMcpToolsToGeminiFunctionDeclarations(mcpTools);

  if (functionDeclarations.length === 0) {
    return {};
  }

  return {
    tools: [{ functionDeclarations }]
  };
}
