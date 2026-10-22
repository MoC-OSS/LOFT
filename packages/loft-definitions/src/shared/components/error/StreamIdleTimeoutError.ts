/**
 * @experimental
 * Thrown when a model stream stays silent for longer than the allowed time.
 */
export class StreamIdleTimeoutError extends Error {
  // A literal, because constructor.name breaks when a minifier renames the class
  override readonly name = 'StreamIdleTimeoutError';

  constructor(readonly timeoutMs?: number) {
    super('The model stream was idle for too long.');
  }
}
