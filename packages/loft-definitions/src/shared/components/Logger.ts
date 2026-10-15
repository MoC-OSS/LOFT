import { LogError, Logger as LoggerInterface, LoggerStrategy, LogLevel } from '../../interfaces/Logger';
import { PinoLoggerStrategy } from './PinoLoggerStrategy';

export interface LoggerConfigOptions {
  logLevel?: LogLevel;
  loggerStrategy?: LoggerStrategy;
}

export class Logger implements LoggerInterface {
  private static _logLevel: LogLevel = LogLevel.INFO;
  private static _loggerStrategy: LoggerStrategy = new PinoLoggerStrategy();

  private readonly targetName: string;

  constructor(targetName: string) {
    if (!targetName) {
      throw new Error('targetName is required');
    }
    this.targetName = targetName;
  }

  static configure(config: LoggerConfigOptions = {}): void {
    Logger._logLevel = config.logLevel ?? LogLevel.INFO;
    Logger._loggerStrategy = config.loggerStrategy ?? new PinoLoggerStrategy();
  }

  static get logLevel(): LogLevel {
    return Logger._logLevel;
  }

  static get loggerStrategy(): LoggerStrategy {
    return Logger._loggerStrategy;
  }

  child(targetName: string): LoggerInterface {
    return new Logger(targetName);
  }

  fatal(message: any, error: LogError, ...extra: any[]): void {
    Logger._loggerStrategy.fatal(message, this.targetName, error, ...extra);
  }

  error(message: any, error?: LogError, ...extra: any[]): void {
    if (Logger._logLevel <= LogLevel.ERROR) {
      Logger._loggerStrategy.error(message, this.targetName, error, ...extra);
    }
  }

  warn(message: any, ...extra: any[]): void {
    if (Logger._logLevel <= LogLevel.WARN) {
      Logger._loggerStrategy.warn(message, this.targetName, ...extra);
    }
  }

  info(message: any, ...extra: any[]): void {
    if (Logger._logLevel <= LogLevel.INFO) {
      Logger._loggerStrategy.info(message, this.targetName, ...extra);
    }
  }

  debug(message: any, ...extra: any[]): void {
    if (Logger._logLevel <= LogLevel.DEBUG) {
      Logger._loggerStrategy.debug(message, this.targetName, ...extra);
    }
  }

  trace(message: any, ...extra: any[]): void {
    if (Logger._logLevel <= LogLevel.TRACE) {
      Logger._loggerStrategy.trace(message, this.targetName, ...extra);
    }
  }
}
