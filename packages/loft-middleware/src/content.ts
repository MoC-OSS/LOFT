import type { Type } from '@moc-global/loft-definitions';

import type { ToolOutputPart } from './types';

export type TextMap = (text: string) => string;

// Message content and tool arguments are far shallower; a deeper value is replaced, so nothing in it leaves unmasked
const MAX_DEPTH = 64;
/** What a value nested deeper than the limit becomes. */
export const TRUNCATED_TEXT = '[truncated]';

/**
 * Rewrites every string inside a value, object keys included unless `keys` is false: plain objects, arrays and class instances become copies
 * of their own enumerable fields, an error becomes `{ name, message }`, a value with `toJSON` becomes what it returns,
 * and a map or a set becomes an array of its entries. A number or a bigint is rewritten as text, such as a card number
 * written as a number, and becomes the rewritten text when the map changes it. When two keys are rewritten to the same
 * key, the later field wins. Dates, binary data and functions are kept as they are. A value nested more than 64 levels
 * deep becomes `[truncated]`. The value passed in is never changed.
 */
export function mapStrings(value: unknown, map: TextMap, options: MapStringsOptions = {}): unknown {
  return mapValue(value, map, new WeakMap(), 0, options.keys ?? true);
}

export interface MapStringsOptions {
  /** Whether object keys are rewritten too. Default true; false for a value whose keys are a fixed schema */
  keys?: boolean;
}

// A string, or a number or a bigint as text; other values that are not objects are kept as they are
function mapPrimitive(value: unknown, map: TextMap): unknown {
  if (typeof value === 'string') return map(value);
  if (typeof value !== 'number' && typeof value !== 'bigint') return value;
  const text = String(value);
  const mapped = map(text);
  return mapped === text ? value : mapped;
}

function mapValue(value: unknown, map: TextMap, seen: WeakMap<object, unknown>, depth: number, keys: boolean): unknown {
  if (typeof value !== 'object' || value === null) return mapPrimitive(value, map);
  if (value instanceof Date || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  if (depth > MAX_DEPTH) return TRUNCATED_TEXT;
  const known = seen.get(value);
  if (known !== undefined) return known;
  if (value instanceof Error) {
    const copy = { name: value.name, message: map(value.message) };
    seen.set(value, copy);
    return copy;
  }
  if (value instanceof Map || value instanceof Set) return mapValue([...value], map, seen, depth, keys);
  if ('toJSON' in value && typeof value.toJSON === 'function') {
    return mapValue(value.toJSON(), map, seen, depth + 1, keys);
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(mapValue(item, map, seen, depth + 1, keys));
    return copy;
  }
  return mapFields(value, map, seen, depth, keys);
}

function mapFields(value: object, map: TextMap, seen: WeakMap<object, unknown>, depth: number, keys: boolean): unknown {
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, field] of Object.entries(value)) {
    // Defined, not assigned, so a key such as `__proto__` stays a field
    Object.defineProperty(copy, keys ? map(key) : key, {
      value: mapValue(field, map, seen, depth + 1, keys),
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  return copy;
}

// The text of an embedded resource; a blob resource has none
function resourceText(resource: object): string | undefined {
  return 'text' in resource && typeof resource.text === 'string' ? resource.text : undefined;
}

// The text of a resource link: its uri, name, title and description, one per line
function linkText(link: object): string {
  const fields = ['uri', 'name', 'title', 'description'].map((field) => (link as Record<string, unknown>)[field]);
  return fields.filter((field): field is string => typeof field === 'string').join('\n');
}

/** Rewrites the text of text parts and text resources; other parts, such as images, are kept as they are. */
export function mapToolContent(parts: readonly ToolOutputPart[], map: TextMap): ToolOutputPart[] {
  return parts.map((part): ToolOutputPart => {
    if (part.type === 'text') return { ...part, text: map(part.text) };
    const text = part.type === 'resource' ? resourceText(part.resource) : undefined;
    if (part.type === 'resource' && text !== undefined)
      return { ...part, resource: { ...part.resource, text: map(text) } };
    // A link's uri, name and description are stored with the tool message
    if (part.type === 'resource_link') return mapStrings(part, map, { keys: false }) as ToolOutputPart;
    return part;
  });
}

/**
 * Rewrites the text a message sends to the model: text parts, text resources, resource links, tool results and tool
 * arguments.
 */
export function mapContent(parts: readonly Type.Entity.FullContentPart[], map: TextMap): Type.Entity.FullContentPart[] {
  return parts.map((part): Type.Entity.FullContentPart => {
    switch (part.type) {
      case 'text':
        return { ...part, text: map(part.text) };
      case 'resource': {
        const text = resourceText(part.resource);
        return text === undefined ? part : { ...part, resource: { ...part.resource, text: map(text) } };
      }
      case 'tool_result':
        return { ...part, content: mapToolContent(part.content, map) };
      case 'tool_call': {
        const args = part.params.arguments;
        return args ? { ...part, params: { ...part.params, arguments: mapRecord(args, map) } } : part;
      }
      // A link's uri, name and description are stored with the message and sent to the model
      case 'resource_link':
        return mapStrings(part, map, { keys: false }) as Type.Entity.FullContentPart;
      default:
        return part;
    }
  });
}

function mapRecord(record: Record<string, unknown>, map: TextMap): Record<string, unknown> {
  return mapStrings(record, map) as Record<string, unknown>;
}

/** The text of the parts that carry text, one part per line; a resource link gives its uri, name, title and description. */
export function textOfParts(parts: readonly (Type.Entity.FullContentPart | ToolOutputPart)[]): string {
  const texts: string[] = [];
  for (const part of parts) {
    if (part.type === 'text') texts.push(part.text);
    else if (part.type === 'resource') texts.push(resourceText(part.resource) ?? '');
    else if (part.type === 'resource_link') texts.push(linkText(part));
    else if (part.type === 'tool_result') texts.push(textOfParts(part.content));
  }
  return texts.join('\n');
}

/** The message of an error, or the value as text. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
