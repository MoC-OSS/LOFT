import type { UnifiedUsage } from './UnifiedUsage';

/**
 * @experimental
 * Usage without Date fields, safe to serialise.
 */
export type StreamUsage = Omit<UnifiedUsage, 'generateStartTime'>;

/**
 * @experimental
 * What a provider reports while it streams one request.
 */
export type LlmStreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'reasoning-delta'; delta: string }
  /** Usage so far for this request. Fields are running totals: a later value replaces an earlier one; never sum them. */
  | { type: 'usage'; usage: Partial<StreamUsage> }
  /** A non-empty chunk the provider keeps back, e.g. tool-call arguments or a non-first choice. */
  | { type: 'activity' }
  /** Emitted by call managers right before each provider attempt; never by providers. */
  | { type: 'request-start' };

/**
 * @experimental
 * Receives the events of one streamed request. Returns true when the event reached the consumer, which counts as
 * delivered output for the call manager's retry decision.
 */
export type LlmStreamSink = (event: LlmStreamEvent) => boolean | void;
