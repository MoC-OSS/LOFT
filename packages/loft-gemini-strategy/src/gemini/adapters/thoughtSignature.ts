// Gemini 3 signs its thinking and rejects a later request whose function calls come back without their signatures,
// so the strategy keeps each signature in the part's _meta
const META_KEY = 'geminiThoughtSignature';

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
