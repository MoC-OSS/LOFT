import { Interface, Logger, PinoLoggerStrategy } from '@moc-global/loft-definitions';
import { vi } from 'vitest';

/**
 * Configures Logger with a spy strategy for asserting on log calls.
 * Calls are forwarded to the real PinoLoggerStrategy only when LOFT_TEST_LOGS is set,
 * so test output stays quiet by default (run `LOFT_TEST_LOGS=1 pnpm test:unit` to see the logs).
 *
 * Usage:
 * ```typescript
 * const strategy = configureSpyLoggerStrategy();
 *
 * beforeEach(() => vi.clearAllMocks());
 *
 * it('should log trace message', () => {
 *   expect(strategy.trace).toHaveBeenCalledWith('message', 'TargetName', { extra: 'data' });
 * });
 * ```
 */
export function configureSpyLoggerStrategy(logLevel: Interface.LogLevel = Interface.LogLevel.TRACE) {
  const realStrategy = process.env.LOFT_TEST_LOGS ? new PinoLoggerStrategy() : undefined;

  const strategy: Interface.LoggerStrategy = {
    trace: vi.fn((...args: Parameters<Interface.LoggerStrategy['trace']>) => realStrategy?.trace(...args)),
    debug: vi.fn((...args: Parameters<Interface.LoggerStrategy['debug']>) => realStrategy?.debug(...args)),
    info: vi.fn((...args: Parameters<Interface.LoggerStrategy['info']>) => realStrategy?.info(...args)),
    warn: vi.fn((...args: Parameters<Interface.LoggerStrategy['warn']>) => realStrategy?.warn(...args)),
    error: vi.fn((...args: Parameters<Interface.LoggerStrategy['error']>) => realStrategy?.error(...args)),
    fatal: vi.fn((...args: Parameters<Interface.LoggerStrategy['fatal']>) => realStrategy?.fatal(...args))
  };

  Logger.configure({ logLevel, loggerStrategy: strategy });

  return strategy;
}

/**
 * Configures Logger with a mock strategy (no real console output).
 *
 * Usage:
 * ```typescript
 * const strategy = configureMockLoggerStrategy();
 *
 * beforeEach(() => vi.clearAllMocks());
 * ```
 */
export function configureMockLoggerStrategy(logLevel: Interface.LogLevel = Interface.LogLevel.DEBUG) {
  const strategy: Interface.LoggerStrategy = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  };

  Logger.configure({ logLevel, loggerStrategy: strategy });

  return strategy;
}
