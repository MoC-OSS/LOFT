import { Chat, Interface } from '@moc-global/loft-definitions';

interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  backoffMultiplier: number;
}

export interface ChatConfig {
  /**
   * How long `shutdown()` waits for the requests in flight, in milliseconds. It then logs a warning and returns,
   * so the process can exit. No limit when unset.
   */
  shutdownTimeout?: number;
  /**
   * The most messages of a session's history that a request loads into its context: the latest ones. Default: all.
   * Set it to bound the database load of long sessions; the context window cropper then works on these messages.
   */
  historyLimit?: number;
  mcp?: {
    toolCacheTtl?: number;
    maxCallsPerGenerate?: number;
  };
  /**
   * @experimental
   * The streaming defaults of every `generate()` call that passes `onEvent`. A call's `streamOptions` are merged over
   * them, key by key.
   */
  streaming?: Chat.StreamOptions;
}

export interface ChatConfigWithSMG extends ChatConfig {
  retryConfig?: RetryConfig;
}

export interface LoftConfig {
  logLevel?: Interface.LogLevel;
}
