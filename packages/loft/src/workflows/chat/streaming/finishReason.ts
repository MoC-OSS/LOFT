import { Chat, Strategy } from '@moc-global/loft-definitions';

// The finish reasons of the providers, as they send them, and LOFT's own. Gemini's are upper case, so no two
// providers share a key.
const FINISH_REASONS: Record<string, Chat.ChatFinishReason> = {
  // OpenAI
  stop: 'stop',
  length: 'length',
  content_filter: 'content-filter',
  tool_calls: 'tool-calls',
  function_call: 'tool-calls',
  // Anthropic
  end_turn: 'stop',
  stop_sequence: 'stop',
  max_tokens: 'length',
  model_context_window_exceeded: 'length',
  tool_use: 'tool-calls',
  refusal: 'content-filter',
  pause_turn: 'other',
  // Gemini
  STOP: 'stop',
  MAX_TOKENS: 'length',
  SAFETY: 'content-filter',
  RECITATION: 'content-filter',
  BLOCKLIST: 'content-filter',
  PROHIBITED_CONTENT: 'content-filter',
  SPII: 'content-filter',
  IMAGE_SAFETY: 'content-filter',
  IMAGE_PROHIBITED_CONTENT: 'content-filter',
  IMAGE_RECITATION: 'content-filter',
  // An unsupported language, not a safety stop
  LANGUAGE: 'other',
  MALFORMED_FUNCTION_CALL: 'error',
  // LOFT's own, for a response no provider call produced
  [Strategy.LLM.LoftFinishReason.INTERCEPTOR_OVERRIDE]: 'other',
  [Strategy.LLM.LoftFinishReason.MIDDLEWARE_OVERRIDE]: 'other',
  [Strategy.LLM.LoftFinishReason.MAX_LOOPS_EXCEEDED]: 'other'
};

/**
 * The finish reason of a step or a generation, the same across providers. Gemini ends a step that calls tools with
 * `STOP`, so a step that had tool calls and stopped counts as `tool-calls`. An unknown reason is `other`.
 */
export function normalizeFinishReason(finishReason: string, hadToolCalls: boolean): Chat.ChatFinishReason {
  const reason = Object.hasOwn(FINISH_REASONS, finishReason) ? FINISH_REASONS[finishReason] : 'other';
  return reason === 'stop' && hadToolCalls ? 'tool-calls' : reason;
}
