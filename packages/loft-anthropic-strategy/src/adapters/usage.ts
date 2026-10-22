import Anthropic from '@anthropic-ai/sdk';
import { Strategy } from '@moc-global/loft-definitions';

/**
 * The usage of an Anthropic message in LOFT's terms. The cache tokens are the input tokens read from the prompt cache.
 */
export function anthropicUsageToUnified(
  usage: Anthropic.Usage | undefined,
  model: string | undefined,
  stopReason: string | null | undefined
): Strategy.LLM.StreamUsage {
  return {
    inputTokens: usage?.input_tokens || 0,
    outputTokens: usage?.output_tokens || 0,
    totalTokens: (usage?.input_tokens || 0) + (usage?.output_tokens || 0),
    cacheTokens: usage?.cache_read_input_tokens || undefined,
    model,
    finishReason: stopReason || undefined
  };
}

/** The counts of a streamed `message_start` or `message_delta` event, each a total for the whole message so far. */
export interface AnthropicStreamedCounts {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/**
 * The usage a streamed event reports, with only the counts the event carries: a `message_delta` sends the output
 * tokens, and the input and cache tokens only when they apply. `inputTokens` is the event's own count or, when it has
 * none, the one an earlier event of the message reported, so `totalTokens` adds up the counts known so far, as the
 * usage of the final message does.
 */
export function anthropicStreamUsage(
  counts: AnthropicStreamedCounts,
  known: { inputTokens?: number; model?: string },
  stopReason?: string | null
): Partial<Strategy.LLM.StreamUsage> {
  const input = typeof counts.input_tokens === 'number' ? counts.input_tokens : undefined;
  const output = typeof counts.output_tokens === 'number' ? counts.output_tokens : undefined;
  const totalInput = input ?? known.inputTokens;
  const usage: Partial<Strategy.LLM.StreamUsage> = {};
  if (input !== undefined) usage.inputTokens = input;
  if (output !== undefined) usage.outputTokens = output;
  if (totalInput !== undefined && output !== undefined) usage.totalTokens = totalInput + output;
  if (counts.cache_read_input_tokens) usage.cacheTokens = counts.cache_read_input_tokens;
  if (known.model) usage.model = known.model;
  if (stopReason) usage.finishReason = stopReason;
  return usage;
}
