import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LogLevel } from '../interfaces/Logger';
import { Logger } from '../shared/components/Logger';
import { PinoLoggerStrategy } from '../shared/components/PinoLoggerStrategy';
import { externalLogger, logFromExternalModule } from './fixtures/ExternalLoggerModule';

describe('Logger', () => {
  const mockLoggerStrategy = {
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn()
  };

  afterEach(() => {
    Logger.configure();
    vi.clearAllMocks();
  });

  describe('new instantiation pattern (without DI)', () => {
    beforeEach(() => {
      Logger.configure({
        logLevel: LogLevel.DEBUG,
        loggerStrategy: mockLoggerStrategy
      });
    });

    it('should create logger with just a name using global config', () => {
      const logger = new Logger('TestService');

      logger.info('test message');

      expect(mockLoggerStrategy.info).toHaveBeenCalledWith('test message', 'TestService');
    });

    it('should respect global log level', () => {
      Logger.configure({
        logLevel: LogLevel.ERROR,
        loggerStrategy: mockLoggerStrategy
      });

      const logger = new Logger('TestService');

      logger.debug('debug message');
      logger.error('error message');

      expect(mockLoggerStrategy.debug).not.toHaveBeenCalled();
      expect(mockLoggerStrategy.error).toHaveBeenCalledWith('error message', 'TestService', undefined);
    });

    it('should use default strategy when not configured', () => {
      Logger.configure();
      const logger = new Logger('TestService');

      // Should not throw, uses default PinoLoggerStrategy
      expect(() => logger.info('test')).not.toThrow();
    });

    it('should allow multiple loggers with different names', () => {
      const logger1 = new Logger('Service1');
      const logger2 = new Logger('Service2');

      logger1.info('from service 1');
      logger2.info('from service 2');

      expect(mockLoggerStrategy.info).toHaveBeenCalledWith('from service 1', 'Service1');
      expect(mockLoggerStrategy.info).toHaveBeenCalledWith('from service 2', 'Service2');
    });

    it('should support child logger creation', () => {
      const parentLogger = new Logger('ParentService');
      const childLogger = parentLogger.child('ChildService');

      childLogger.info('child message');

      expect(mockLoggerStrategy.info).toHaveBeenCalledWith('child message', 'ChildService');
    });

    it('should always log fatal regardless of LogLevel', () => {
      Logger.configure({
        logLevel: LogLevel.NONE,
        loggerStrategy: mockLoggerStrategy
      });

      const logger = new Logger('TestService');
      const testError = new Error('test error');
      logger.fatal('critical error', testError);

      expect(mockLoggerStrategy.fatal).toHaveBeenCalledWith('critical error', 'TestService', testError);
    });

    it('should block all logs except fatal when LogLevel is NONE', () => {
      Logger.configure({
        logLevel: LogLevel.NONE,
        loggerStrategy: mockLoggerStrategy
      });

      const logger = new Logger('TestService');
      const testError = new Error('test');

      logger.fatal('fatal', testError);
      logger.error('error');
      logger.warn('warn');
      logger.info('info');
      logger.debug('debug');
      logger.trace('trace');

      expect(mockLoggerStrategy.fatal).toHaveBeenCalledOnce();
      expect(mockLoggerStrategy.error).not.toHaveBeenCalled();
      expect(mockLoggerStrategy.warn).not.toHaveBeenCalled();
      expect(mockLoggerStrategy.info).not.toHaveBeenCalled();
      expect(mockLoggerStrategy.debug).not.toHaveBeenCalled();
      expect(mockLoggerStrategy.trace).not.toHaveBeenCalled();
    });

    it('should create child logger that uses current Logger config', () => {
      Logger.configure({
        logLevel: LogLevel.INFO,
        loggerStrategy: mockLoggerStrategy
      });

      const parent = new Logger('Parent');
      const child = parent.child('Child');

      child.info('test message');

      expect(mockLoggerStrategy.info).toHaveBeenCalledWith('test message', 'Child');
    });
  });

  describe('constructor validation', () => {
    it('should throw error for empty/null/undefined targetName', () => {
      expect(() => new Logger('')).toThrow('targetName is required');
      expect(() => new Logger(null as any)).toThrow('targetName is required');
      expect(() => new Logger(undefined as any)).toThrow('targetName is required');
    });

    it('should work with valid targetName', () => {
      expect(() => new Logger('ValidService')).not.toThrow();
    });
  });

  describe('strategy failure handling', () => {
    it('should propagate LoggerStrategy method failures', () => {
      const failingStrategy = {
        fatal: vi.fn().mockImplementation(() => {
          throw new Error('Fatal failed');
        }),
        error: vi.fn().mockImplementation(() => {
          throw new Error('Error failed');
        }),
        warn: vi.fn().mockImplementation(() => {
          throw new Error('Warn failed');
        }),
        info: vi.fn().mockImplementation(() => {
          throw new Error('Info failed');
        }),
        debug: vi.fn().mockImplementation(() => {
          throw new Error('Debug failed');
        }),
        trace: vi.fn().mockImplementation(() => {
          throw new Error('Trace failed');
        })
      };

      Logger.configure({
        logLevel: LogLevel.TRACE,
        loggerStrategy: failingStrategy
      });

      const logger = new Logger('TestService');

      expect(() => logger.fatal('test', new Error('test'))).toThrow('Fatal failed');
      expect(() => logger.error('test')).toThrow('Error failed');
      expect(() => logger.warn('test')).toThrow('Warn failed');
      expect(() => logger.info('test')).toThrow('Info failed');
      expect(() => logger.debug('test')).toThrow('Debug failed');
      expect(() => logger.trace('test')).toThrow('Trace failed');

      expect(failingStrategy.fatal).toHaveBeenCalled();
      expect(failingStrategy.error).toHaveBeenCalled();
      expect(failingStrategy.warn).toHaveBeenCalled();
      expect(failingStrategy.info).toHaveBeenCalled();
      expect(failingStrategy.debug).toHaveBeenCalled();
      expect(failingStrategy.trace).toHaveBeenCalled();
    });
  });

  describe('LogLevel boundary cases', () => {
    const allLevels = [
      { level: LogLevel.NONE, shouldLog: ['fatal'], name: 'NONE' },
      { level: LogLevel.FATAL, shouldLog: ['fatal'], name: 'FATAL' },
      { level: LogLevel.ERROR, shouldLog: ['fatal', 'error'], name: 'ERROR' },
      { level: LogLevel.WARN, shouldLog: ['fatal', 'error', 'warn'], name: 'WARN' },
      { level: LogLevel.INFO, shouldLog: ['fatal', 'error', 'warn', 'info'], name: 'INFO' },
      { level: LogLevel.DEBUG, shouldLog: ['fatal', 'error', 'warn', 'info', 'debug'], name: 'DEBUG' },
      { level: LogLevel.TRACE, shouldLog: ['fatal', 'error', 'warn', 'info', 'debug', 'trace'], name: 'TRACE' }
    ];

    allLevels.forEach(({ level, shouldLog, name }) => {
      it(`LogLevel.${name} should log only: ${shouldLog.join(', ')}`, () => {
        Logger.configure({
          logLevel: level,
          loggerStrategy: mockLoggerStrategy
        });

        const logger = new Logger('TestService');
        const testError = new Error('test');

        logger.fatal('fatal', testError);
        logger.error('error');
        logger.warn('warn');
        logger.info('info');
        logger.debug('debug');
        logger.trace('trace');

        (['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const).forEach((method) => {
          if (shouldLog.includes(method)) {
            expect(mockLoggerStrategy[method]).toHaveBeenCalled();
          } else {
            expect(mockLoggerStrategy[method]).not.toHaveBeenCalled();
          }
        });
      });
    });
  });

  describe('Logger static configuration', () => {
    it('should return configured values via static getters', () => {
      const strategy = new PinoLoggerStrategy();

      Logger.configure({
        logLevel: LogLevel.TRACE,
        loggerStrategy: strategy
      });

      expect(Logger.logLevel).toBe(LogLevel.TRACE);
      expect(Logger.loggerStrategy).toBe(strategy);
    });

    it('should provide defaults when configure() called without args', () => {
      Logger.configure();

      expect(Logger.logLevel).toBe(LogLevel.INFO);
      expect(Logger.loggerStrategy).toBeInstanceOf(PinoLoggerStrategy);
    });

    it('should allow partial configuration', () => {
      Logger.configure({ logLevel: LogLevel.DEBUG });

      expect(Logger.logLevel).toBe(LogLevel.DEBUG);
      expect(Logger.loggerStrategy).toBeInstanceOf(PinoLoggerStrategy);
    });
  });

  describe('Global configuration across modules', () => {
    it('should share configuration between loggers from different modules', () => {
      Logger.configure({
        logLevel: LogLevel.ERROR,
        loggerStrategy: mockLoggerStrategy
      });

      const localLogger = new Logger('LocalModule');

      // Both loggers respect the same log level filter
      localLogger.info('filtered local');
      externalLogger.info('filtered external');
      expect(mockLoggerStrategy.info).not.toHaveBeenCalled();

      // Both loggers use the same strategy
      localLogger.error('local error');
      logFromExternalModule('external via function'); // uses info level - filtered
      externalLogger.error('external error');

      expect(mockLoggerStrategy.error).toHaveBeenCalledTimes(2);
      expect(mockLoggerStrategy.error).toHaveBeenNthCalledWith(1, 'local error', 'LocalModule', undefined);
      expect(mockLoggerStrategy.error).toHaveBeenNthCalledWith(2, 'external error', 'ExternalModule', undefined);
    });
  });
});
