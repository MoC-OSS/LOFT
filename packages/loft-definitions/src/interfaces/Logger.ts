export enum LogLevel {
  NONE = 100,
  FATAL = 60,
  ERROR = 50,
  WARN = 40,
  INFO = 30,
  DEBUG = 20,
  TRACE = 10
}

export type LogError = Error | unknown;

export interface Logger {
  child(targetName: string): Logger;

  fatal(message: any, error: LogError, ...extra: any[]): void;

  error(message: any, error: LogError, ...extra: any[]): void;

  warn(message: any, ...extra: any[]): void;

  info(message: any, ...extra: any[]): void;

  debug(message: any, ...extra: any[]): void;

  trace(message: any, ...extra: any[]): void;
}

export interface LoggerStrategy {
  fatal(message: any, targetName: string, error: LogError, ...extra: any[]): void;

  error(message: any, targetName: string, error?: LogError, ...extra: any[]): void;

  warn(message: any, targetName: string, ...extra: any[]): void;

  info(message: any, targetName: string, ...extra: any[]): void;

  debug(message: any, targetName: string, ...extra: any[]): void;

  trace(message: any, targetName: string, ...extra: any[]): void;
}
