import { Interface } from '@moc-global/loft-definitions';

interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  backoffMultiplier: number;
}

export interface ChatConfig {
  mcp?: {
    toolCacheTtl?: number;
    maxCallsPerGenerate?: number;
  };
}

export interface ChatConfigWithSMG extends ChatConfig {
  retryConfig?: RetryConfig;
}

export interface LoftConfig {
  logLevel?: Interface.LogLevel;
}
