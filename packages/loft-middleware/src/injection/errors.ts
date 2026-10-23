/** Thrown by `injectionGuard` with `onUserFlag: 'throw'`, before `generate()` emits any event. */
export class InjectionDetectedError extends Error {
  constructor(readonly categories: readonly string[]) {
    super('The message was blocked: possible prompt injection');
    this.name = 'InjectionDetectedError';
  }
}

// LOFT wraps a middleware error twice: in the middleware failure, then in a GenerateError
const MAX_CAUSES = 10;

// By name as well as by class: an application that loads both the CommonJS and the ES module build has two classes
const isInjectionDetected = (error: Error): error is InjectionDetectedError =>
  error instanceof InjectionDetectedError ||
  (error.name === 'InjectionDetectedError' && 'categories' in error && Array.isArray(error.categories));

/** The `InjectionDetectedError` behind an error that `generate()` rejected with, if there is one. */
export function findInjectionDetected(error: unknown): InjectionDetectedError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSES && current instanceof Error; depth++) {
    if (isInjectionDetected(current)) return current;
    current = current.cause;
  }
  return undefined;
}
