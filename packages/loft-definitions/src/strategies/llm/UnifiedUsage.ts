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
  /** Stop reason: the provider's own value, or a `LoftFinishReason` when LOFT made the response itself. */
  finishReason?: string;
}

/** The finish reasons LOFT sets on a response that no provider call produced. */
export enum LoftFinishReason {
  /** A tool interceptor replaced the reply. */
  INTERCEPTOR_OVERRIDE = 'interceptor_override',
  /** BeforeGenerate middleware prevented the generation and supplied the reply. */
  MIDDLEWARE_OVERRIDE = 'middleware_override',
  /** The tool loop reached its limit before the model gave a final answer. */
  MAX_LOOPS_EXCEEDED = 'max_loops_exceeded'
}
