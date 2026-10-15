/** Longest string value copied into a prompt; longer values are cut and marked with "…". */
export const MAX_PROMPT_DATA_STRING_LENGTH = 500;

function capStrings(value: unknown, maxLength: number): unknown {
  if (typeof value === 'string') {
    return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => capStrings(item, maxLength));
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, capStrings(item, maxLength)]));
  }
  return value;
}

/**
 * Serializes user-supplied values for a prompt as one line of JSON. Newlines and quotes are
 * escaped by JSON, and `<` and `>` are escaped too, so a value cannot close the block it sits
 * in or start new prompt sections. String values are capped at `maxStringLength`.
 */
export function toPromptData(value: unknown, maxStringLength = MAX_PROMPT_DATA_STRING_LENGTH): string {
  return JSON.stringify(capStrings(value, maxStringLength)).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}
