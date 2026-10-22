import { Strategy } from '@moc-global/loft-definitions';
import { z } from 'zod';

import type { ScriptedLLMCall, ScriptedReply } from './ScriptedLLMStrategy';
import { ScriptedTurnPlayer } from './scriptedTurns';

/** The tokens `extractUsedTokens` reports for every response; the same as the usage a ScriptedLLMStrategy reports. */
const SCRIPTED_USED_TOKENS = 15;
/** The tokens `llmTokenizer` counts for every request. */
const SCRIPTED_REQUEST_TOKENS = 10;

/**
 * A scripted provider API: the `LLMApi` that a call manager (for example `GenerateCallManager` from
 * `@moc-global/loft-llm-call-manager`) runs behind, so tests exercise the call manager's queue, retries and
 * streaming hand-over without a real provider. It plays the same replies as `ScriptedLLMStrategy`, including the
 * streaming fields, and sends the events of a streamed call to `options.onEvent`. It never sends `request-start`;
 * the call manager does.
 *
 * Its request is a `ScriptedLLMCall` and its response a `ScriptedResponse`. To use it, build a
 * `ScriptedLLMStrategy` whose call manager strategy sends to the call manager:
 *
 * ```ts
 * const api = new ScriptedLLMApi([{ text: 'Hello', chunks: ['Hel', 'lo'] }]);
 * const callManager = new GenerateCallManager<ScriptedLLMCall, ScriptedResponse>('scripted', config, api);
 * const llm = new ScriptedLLMStrategy('scripted', [], new NativeCallManagerStrategy(callManager));
 * ```
 *
 * The rate limiter always allows a call and the tokenizer and `extractUsedTokens` return fixed numbers. The legacy
 * `generateStream` and `extractContentFromChunk` are not supported.
 *
 * @experimental
 */
export class ScriptedLLMApi implements Strategy.LLM.LLMApi {
  readonly tokenRateLimiter: Strategy.LLM.LlmTokenRateLimiter = {
    awaitBeforeCall: async () => undefined,
    acquire: async () => undefined,
    setUsedTokens: () => undefined,
    setUsedRequest: () => undefined
  };
  readonly llmTokenizer: Strategy.LLM.LlmTokenizer = { calculateTokensFromString: () => SCRIPTED_REQUEST_TOKENS };
  private readonly player: ScriptedTurnPlayer;

  /** @throws when the `chunks` of a reply do not join to its `text` */
  constructor(replies: ScriptedReply[] = []) {
    this.player = new ScriptedTurnPlayer('ScriptedLLMApi', replies);
  }

  /** What the API received, one entry per provider call (retries included). */
  get calls(): ScriptedLLMCall[] {
    return this.player.calls;
  }

  /** Replies not used yet. */
  get remainingReplies(): number {
    return this.player.remainingReplies;
  }

  /** Adds replies for later calls. */
  script(...replies: ScriptedReply[]): this {
    this.player.script(...replies);
    return this;
  }

  async generate<T_LLM_Req, T_LLM_Res>(llmRequest: T_LLM_Req, options?: Strategy.LLM.CallOptions): Promise<T_LLM_Res> {
    const response = await this.player.play(llmRequest as unknown as ScriptedLLMCall, options);
    return response as unknown as T_LLM_Res;
  }

  async generateStream<T_LLM_Req, T_LLM_Res>(_llmRequest: T_LLM_Req): Promise<T_LLM_Res> {
    throw new Error('ScriptedLLMApi does not support generateStream');
  }

  extractContentFromChunk<T_LLM_Res>(_chunk: T_LLM_Res): string {
    throw new Error('ScriptedLLMApi does not support extractContentFromChunk');
  }

  reduceMessages<T_LLM_Req>(llmRequest: T_LLM_Req): string {
    const { systemMessage, messages } = llmRequest as unknown as ScriptedLLMCall;
    return [systemMessage, ...messages.map((message) => message.text)].join('\n');
  }

  extractUsedTokens<T_LLM_Res>(_llmResponse: T_LLM_Res): number {
    return SCRIPTED_USED_TOKENS;
  }

  generateRequestValidationSchema() {
    return z.object({}).passthrough();
  }
}
