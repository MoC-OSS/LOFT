import { Strategy } from '../..';

/** @experimental */
export interface ChatStreamEventBase {
  /** 0, 1, 2… with no gaps, per generate() call. */
  seq: number;
  /** One per generate() call. */
  runId: string;
  /** Reserved for loft-agents. */
  source?: { path: string[]; attempt: number };
}

/** @experimental */
export type ChatStreamErrorCode = 'provider_error' | 'rate_limited' | 'timeout' | 'internal';

/**
 * @experimental
 * Why a step or a generation ended, the same across providers: `stop` (the model finished), `length` (it hit the
 * token limit), `content-filter` (a safety filter or a refusal ended it), `tool-calls` (it asked for tools), `error`
 * (the provider failed to finish it, such as a malformed function call) and `other` (any other reason, such as the
 * loop limit). The union may gain values.
 */
export type ChatFinishReason = 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other';

/**
 * @experimental
 * One event of a streamed generate() call.
 */
export type ChatStreamEvent = ChatStreamEventBase &
  /** streaming: true when providers stream this call, false when it is observe-only. */
  (
    | { type: 'start'; sessionId: string; textPolicy: 'all' | 'after-middleware'; streaming: boolean }
    | { type: 'status'; step: number; phase: 'queued' | 'generating' }
    | { type: 'step-start'; step: number }
    | { type: 'text-delta'; step: number; delta: string }
    | { type: 'reasoning-delta'; step: number; delta: string }
    | { type: 'tool-call'; step: number; toolCallId: string; name: string; args?: Record<string, unknown> }
    | { type: 'data'; step: number; toolCallId: string; toolName: string; name: string; data: unknown }
    | {
        type: 'tool-result';
        step: number;
        toolCallId: string;
        name: string;
        status: 'succeeded' | 'failed';
        durationMs: number;
      }
    | {
        type: 'step-finish';
        step: number;
        /** Why the step ended, normalized across providers. */
        reason: ChatFinishReason;
        /** The provider's own finish reason, as it sent it. */
        finishReason: string;
        hadToolCalls: boolean;
        /**
         * True when this step's text reached the consumer as the provider wrote it. False when the text was sent once
         * after the provider call, or the step had no text (for example a step that only called tools).
         */
        streamed: boolean;
        usage?: Strategy.LLM.StreamUsage;
      }
    | {
        type: 'finish';
        /** Why the generation ended, normalized across providers. */
        reason: ChatFinishReason;
        /** The provider's own finish reason of the last step, as it sent it, or `max_loops_exceeded`. */
        finishReason: string;
        text: string;
        textReplaced: boolean;
        usage: Strategy.LLM.StreamUsage;
      }
    | {
        type: 'error';
        code: ChatStreamErrorCode;
        message: string;
        retryable: boolean;
        /** For `rate_limited`: how long the provider asked to wait before a new request, in ms, when it said so. */
        retryAfterMs?: number;
      }
    /** reason: `timeout` when the signal was aborted by a timeout (as `AbortSignal.timeout()` does), else `cancelled`. */
    | { type: 'abort'; reason: 'timeout' | 'cancelled' }
  );

/** @experimental */
export interface StreamOptions {
  /** false = observe-only: events are reported but providers do not stream. Default true. */
  enabled?: boolean;
  include?: {
    /** Default false. */
    reasoning?: boolean;
    /** Default 'names'. */
    toolCalls?: 'none' | 'names' | 'args';
  };
  /** Default: 'after-middleware' if output-transforming middleware is registered, else 'all'. */
  textPolicy?: 'all' | 'after-middleware';
}
