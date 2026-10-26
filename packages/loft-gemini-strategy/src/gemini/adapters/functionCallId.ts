// Gemini can give each function call an id and then matches each function response to its call by that id. The id
// becomes the tool call's callId, and the strategy also keeps it in the part's _meta: that is how it tells a Gemini id
// from a LOFT id (`<name>:::<random>`, made when Gemini sends none) or another provider's id in a shared history, which
// must not be sent to Gemini as its own
const META_KEY = 'geminiFunctionCallId';

/**
 * Builds the _meta that marks the callId of a unified tool call as the id Gemini gave the call
 */
export function functionCallIdMeta(id: string | undefined): { _meta?: Record<string, unknown> } {
  return id ? { _meta: { [META_KEY]: id } } : {};
}

/**
 * Reads the Gemini id back from a unified tool call, as a Gemini function call or response field; a call whose id
 * Gemini did not give has none
 */
export function functionCallIdField(part: { callId?: string; _meta?: Record<string, unknown> }): { id?: string } {
  const id = part._meta?.[META_KEY];
  return typeof id === 'string' && id === part.callId ? { id } : {};
}
