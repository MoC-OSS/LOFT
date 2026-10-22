import type { FunctionDeclaration, Schema, Type } from '@google/genai';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The JSON Schema keywords of a tool's input that the converter reads; any other keyword is left out
 */
interface JsonSchema {
  type?: string | string[];
  nullable?: boolean;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
}

const GEMINI_TYPES: Record<string, Type> = {
  string: 'STRING' as Type,
  number: 'NUMBER' as Type,
  integer: 'INTEGER' as Type,
  boolean: 'BOOLEAN' as Type,
  array: 'ARRAY' as Type,
  object: 'OBJECT' as Type
};

// The keywords that apply to each type, used to split a list of types into one schema per type
const TYPE_KEYWORDS: Record<string, (keyof JsonSchema)[]> = {
  string: ['enum', 'format', 'pattern', 'minLength', 'maxLength'],
  number: ['enum', 'format', 'minimum', 'maximum'],
  integer: ['enum', 'format', 'minimum', 'maximum'],
  boolean: [],
  array: ['items', 'minItems', 'maxItems'],
  object: ['properties', 'required']
};

const isSchema = (value: unknown): value is JsonSchema => typeof value === 'object' && value !== null;

/**
 * Converts JSON Schema type to Gemini Type enum value
 */
function jsonSchemaTypeToGeminiType(type: string | undefined): Type | undefined {
  return typeof type === 'string' ? GEMINI_TYPES[type.toLowerCase()] : undefined;
}

const typeList = (type: JsonSchema['type']): string[] => {
  if (Array.isArray(type)) return type.filter((item): item is string => typeof item === 'string');
  return typeof type === 'string' ? [type] : [];
};

const isNullType = (type: string): boolean => type.toLowerCase() === 'null';

// A branch of anyOf or oneOf that only allows null, such as { type: 'null' }
const isNullBranch = (schema: JsonSchema): boolean => {
  const types = typeList(schema.type);
  return types.length > 0 && types.every(isNullType) && !schema.anyOf && !schema.oneOf;
};

// Gemini takes the length and item counts as int64 strings
const int64 = (value: number | undefined): string | undefined =>
  typeof value === 'number' ? String(value) : undefined;

// The schema without its undefined keys
function defined(schema: Schema): Schema {
  return Object.fromEntries(Object.entries(schema).filter(([, value]) => value !== undefined)) as Schema;
}

/**
 * Converts one JSON Schema to a Gemini Schema:
 * - a list of types becomes its non-null type, or, for several, `anyOf` with one schema per type; a `null` member, a
 *   `{ type: 'null' }` branch, a `null` enum value and OpenAPI's `nullable: true` set `nullable`
 * - enum values are sent as strings, the only kind Gemini takes
 * - `anyOf` and `oneOf` become Gemini's `anyOf`, each branch converted; when only one branch is left besides null, it
 *   becomes the schema itself
 * - the keywords the Gemini Schema has (constraints, `format`, `default`, `title`…) are kept, nested schemas converted
 */
function convertSchema(schema: JsonSchema): Schema {
  const types = typeList(schema.type);
  const nonNullTypes = types.filter((type) => !isNullType(type));
  const branches = [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])].filter(isSchema);
  const nonNullBranches = branches.filter((branch) => !isNullBranch(branch));
  const nullable =
    schema.nullable === true ||
    types.some(isNullType) ||
    nonNullBranches.length < branches.length ||
    (Array.isArray(schema.enum) && schema.enum.includes(null)) ||
    undefined;

  const annotations: Schema = {
    title: schema.title,
    description: schema.description,
    default: schema.default,
    nullable
  };

  if (nonNullTypes.length > 1) {
    const anyOf = nonNullTypes.map((type) => {
      const typed: JsonSchema = { type };
      for (const keyword of TYPE_KEYWORDS[type.toLowerCase()] ?? []) {
        Object.assign(typed, { [keyword]: schema[keyword] });
      }
      return convertSchema(typed);
    });
    return defined({ ...annotations, anyOf });
  }

  const converted: Schema = {
    type: jsonSchemaTypeToGeminiType(nonNullTypes[0]),
    ...annotations,
    // Gemini takes string values only; a null value is covered by `nullable`
    enum: Array.isArray(schema.enum)
      ? schema.enum.filter((value) => value !== null && value !== undefined).map(String)
      : undefined,
    format: schema.format,
    pattern: schema.pattern,
    minimum: schema.minimum,
    maximum: schema.maximum,
    minLength: int64(schema.minLength),
    maxLength: int64(schema.maxLength),
    minItems: int64(schema.minItems),
    maxItems: int64(schema.maxItems),
    items: isSchema(schema.items) ? convertSchema(schema.items) : undefined,
    properties: convertProperties(schema.properties),
    required: Array.isArray(schema.required) ? schema.required : undefined
  };

  if (nonNullBranches.length === 1 && !converted.type) {
    return defined({ ...convertSchema(nonNullBranches[0]), ...defined(converted) });
  }
  if (nonNullBranches.length > 0) {
    converted.anyOf = nonNullBranches.map(convertSchema);
  }

  return defined(converted);
}

/**
 * Converts JSON Schema properties to Gemini Schema properties
 */
function convertProperties(properties: Record<string, JsonSchema> | undefined): Record<string, Schema> | undefined {
  if (!isSchema(properties)) return undefined;

  const result: Record<string, Schema> = {};

  for (const [key, value] of Object.entries(properties)) {
    result[key] = isSchema(value) ? convertSchema(value) : {};
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
      properties: convertProperties(tool.inputSchema.properties as Record<string, JsonSchema> | undefined),
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
