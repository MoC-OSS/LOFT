import type { LlmStreamEvent, LlmStreamSink } from '../../strategies/llm/LlmStreamEvent';

/**
 * Wraps a provider strategy's stream sink so a sink that throws cannot break the stream: the reply is still built.
 * Only the first failure is passed to `warn`, with the event type only, as the error may quote the event.
 */
export function guardedStreamSink(
  onEvent: LlmStreamSink,
  warn: (message: string) => void
): (event: LlmStreamEvent) => void {
  let failed = false;
  return (event) => {
    try {
      onEvent(event);
    } catch {
      if (!failed) warn(`onEvent threw on a ${event.type} event; later failures are not logged`);
      failed = true;
    }
  };
}
