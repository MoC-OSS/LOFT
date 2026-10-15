/* eslint-disable @typescript-eslint/no-unused-vars */
import pino, { Level } from 'pino';

import { Interface } from '../..';

// Credentials that may sit in a logged object; replaced with "[Redacted]" at every log level
const CREDENTIAL_KEYS = ['authorization', 'apiKey', 'api_key', 'password', 'token', 'accessToken', 'secret'];
// Pino paths are case-sensitive, so both the lower-case and the usual capitalised spelling are listed
const CREDENTIAL_HEADERS = [
  'authorization',
  'Authorization',
  'x-api-key',
  'X-Api-Key',
  'api-key',
  'Api-Key',
  'cookie',
  'Cookie'
];

// log() nests everything it is given under `error` and `extra`, so these paths cover every logged object
// one level deep. Credentials nested deeper (an object inside an extra argument) are not redacted.
const REDACTED_LOG_PATHS = [
  ...CREDENTIAL_KEYS.flatMap((key) => [`error.${key}`, `extra[*].${key}`]),
  // Bracket notation with quotes is Pino's path syntax for keys with "-"; the quotes are not part of the header name
  ...CREDENTIAL_HEADERS.flatMap((header) => [`error.headers["${header}"]`, `extra[*].headers["${header}"]`])
];

// HTTP client errors (AxiosError) carry the whole request in these keys: its body (prompts) and its headers (API keys)
const HTTP_ERROR_KEYS = new Set(['config', 'request', 'response']);

export class PinoLoggerStrategy implements Interface.LoggerStrategy {
  private readonly logger: pino.Logger;

  /** @param destination where the JSON lines go; stdout by default */
  constructor(destination?: pino.DestinationStream) {
    const options: pino.LoggerOptions = { level: 'trace', redact: { paths: REDACTED_LOG_PATHS } };
    this.logger = destination ? pino(options, destination) : pino(options);
  }

  private serializeError(error: Error): Record<string, any> {
    const serialized: Record<string, any> = { message: error.message, stack: error.stack };
    for (const [key, value] of Object.entries(error)) {
      if (HTTP_ERROR_KEYS.has(key)) continue;
      serialized[key] = value instanceof Error ? this.serializeError(value) : value;
    }
    // Keep the HTTP status, which is safe and useful
    const status = (error as { response?: { status?: unknown } }).response?.status;
    if (status !== undefined) serialized.status = status;
    if (error.cause instanceof Error) serialized.cause = this.serializeError(error.cause);
    return serialized;
  }

  //works only for Error, object and string
  private serialize(data: any): Record<string, any> {
    if (data instanceof Error) {
      return this.serializeError(data);
    }

    if (Array.isArray(data)) {
      return data.map((item) => (item instanceof Error ? this.serializeError(item) : item));
    }

    if (data && typeof data === 'object') {
      return data;
    }

    if (typeof data === 'string') {
      return {
        error: data
      };
    }

    return {
      error: String(data)
    };
  }

  private log(level: Level, message: any, targetName: string, error?: Interface.LogError, ...extra: any[]): void {
    const logObject: Record<string, any> = {
      source: 'LOFT',
      target: targetName,
      ...(error ? { error: this.serialize(error) } : {}),
      ...(extra.length > 0 ? { extra: this.serialize(extra) } : {})
    };

    this.logger[level](logObject, message);
  }

  fatal(message: any, targetName: string, error: Interface.LogError, ...extra: any[]): void {
    this.log('fatal', message, targetName, error, ...extra);
  }

  error(message: any, targetName: string, error?: Interface.LogError, ...extra: any[]): void {
    this.log('error', message, targetName, error, ...extra);
  }

  warn(message: any, targetName: string, ...extra: any[]): void {
    this.log('warn', message, targetName, undefined, ...extra);
  }

  debug(message: any, targetName: string, ...extra: any[]): void {
    this.log('debug', message, targetName, undefined, ...extra);
  }

  info(message: any, targetName: string, ...extra: any[]): void {
    this.log('info', message, targetName, undefined, ...extra);
  }

  trace(message: any, targetName: string, ...extra: any[]): void {
    this.log('trace', message, targetName, undefined, ...extra);
  }
}
