import type { Part } from '@google/genai';

// Gemini 3 signs its thinking and rejects a later request whose function calls come back without their signatures,
// so the strategy keeps each signature in the part's _meta
const META_KEY = 'geminiThoughtSignature';

// Gemini's documented stand-in for a function call it did not sign, such as one from saved history of an older LOFT
// version or from another model of the session; Gemini 2.5 ignores it
export const SKIP_THOUGHT_SIGNATURE_VALIDATOR = 'skip_thought_signature_validator';

/**
 * Builds the _meta that keeps a Gemini thought signature on a unified content part
 */
export function thoughtSignatureMeta(thoughtSignature: string | undefined): { _meta?: Record<string, unknown> } {
  return thoughtSignature ? { _meta: { [META_KEY]: thoughtSignature } } : {};
}

/**
 * Reads the Gemini thought signature back from a unified content part, as a Gemini part field
 */
export function thoughtSignatureField(part: { _meta?: Record<string, unknown> }): { thoughtSignature?: string } {
  const thoughtSignature = part._meta?.[META_KEY];
  return typeof thoughtSignature === 'string' ? { thoughtSignature } : {};
}

/**
 * Signs the first function call of a model turn with the stand-in when none of its calls has a signature; Gemini 3
 * rejects a turn of unsigned calls and, for parallel calls, checks only the first
 */
export function signUnsignedFunctionCalls(parts: Part[]): Part[] {
  const calls = parts.filter((part) => part.functionCall);
  if (calls.length > 0 && !calls.some((part) => part.thoughtSignature)) {
    calls[0].thoughtSignature = SKIP_THOUGHT_SIGNATURE_VALIDATOR;
  }
  return parts;
}
