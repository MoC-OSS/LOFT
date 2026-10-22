import { ZodSchema } from 'zod';

import { LlmStreamSink } from './LlmStreamEvent';
import { LlmTokenizer } from './LlmTokenizerInterface';
import { LlmTokenRateLimiter } from './LlmTokenRateLimiterInterface';

/** Per-call options for a single LLM request. */
export interface CallOptions {
  /** Aborts the provider request; the call then rejects with the SDK's abort error. */
  signal?: AbortSignal;
  /** @experimental Set by LOFT to stream this call. Providers that cannot stream ignore it. Never throws. */
  onEvent?: LlmStreamSink;
}

export interface LLMApi {
  generate<T_LLM_Req, T_LLM_Res>(llmRequest: T_LLM_Req, options?: CallOptions): Promise<T_LLM_Res>;
  /**
   * @deprecated Use chat.generate({ onEvent }) instead.
   * Removed in the next major release.
   */
  generateStream<T_LLM_Req, T_LLM_Res>(llmRequest: T_LLM_Req): Promise<T_LLM_Res>;
  /**
   * @deprecated Use chat.generate({ onEvent }) instead.
   * Removed in the next major release.
   */
  extractContentFromChunk<T_LLM_Res>(chunk: T_LLM_Res): string;
  reduceMessages<T_LLM_Req>(llmRequest: T_LLM_Req): string;
  extractUsedTokens<T_LLM_Res>(llmResponse: T_LLM_Res): number;
  tokenRateLimiter: LlmTokenRateLimiter;
  llmTokenizer: LlmTokenizer;
  generateRequestValidationSchema: () => ZodSchema<any>; // now it is optional
}
