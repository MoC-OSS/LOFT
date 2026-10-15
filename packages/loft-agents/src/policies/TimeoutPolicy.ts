import { Agent } from '@moc-global/loft-definitions';

import { NodeTimeoutError } from '../errors';

/**
 * Runs `fn` with a deadline. On timeout the signal passed to `fn` is aborted, which cancels
 * the node's in-flight LLM call, and the returned promise rejects with NodeTimeoutError.
 * An aborted `parentSignal` (a cancelled orchestrator run) aborts `fn` as well.
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  policy: Agent.TimeoutPolicy,
  nodeName: string,
  parentSignal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeoutError = new NodeTimeoutError(nodeName, policy.timeoutMs);
      controller.abort(timeoutError);
      reject(timeoutError);
    }, policy.timeoutMs);

    fn(signal).then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
