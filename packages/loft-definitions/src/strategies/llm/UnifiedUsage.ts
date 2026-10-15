/**
 * Unified usage metrics for all LLM providers
 * Each strategy is responsible for converting provider-specific format to this unified structure
 * All providers return at least basic token counts, so core metrics are required
 */
export interface UnifiedUsage {
  // Core token metrics (required, use 0 if not available)
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;

  // Additional metrics (optional)
  cacheTokens?: number; // Tokens from cache (Anthropic)
  reasoningTokens?: number; // Reasoning tokens (OpenAI o1/o3)

  // Cost information (if available)
  totalCost?: number; // In USD

  // Timing information
  generateStartTime?: Date; // When LLM started generating (for completionStartTime)

  // Metadata
  model?: string; // Model name/version
  finishReason?: string; // Stop reason
}
