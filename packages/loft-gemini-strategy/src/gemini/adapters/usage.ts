import type { GenerateContentResponseUsageMetadata } from '@google/genai';
import { Strategy } from '@moc-global/loft-definitions';

/**
 * The usage of a Gemini response in LOFT's terms. The output tokens are the candidates' tokens; the thinking tokens are
 * reported apart, as `reasoningTokens`, and counted in the total.
 */
export function geminiUsageToUnified(
  usage: GenerateContentResponseUsageMetadata | undefined,
  model: string | undefined,
  finishReason: string | undefined
): Strategy.LLM.StreamUsage {
  return {
    inputTokens: usage?.promptTokenCount || 0,
    outputTokens: usage?.candidatesTokenCount || 0,
    totalTokens: usage?.totalTokenCount || 0,
    ...(usage?.thoughtsTokenCount !== undefined && { reasoningTokens: usage.thoughtsTokenCount }),
    model: model || undefined,
    ...(finishReason && { finishReason })
  };
}
