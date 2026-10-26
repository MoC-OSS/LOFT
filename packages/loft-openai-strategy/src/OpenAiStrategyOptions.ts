/**
 * @experimental
 * Options of `OpenAiCallStrategy` and `AzureOpenAiCallStrategy`, passed as their last constructor argument.
 */
export interface OpenAiStrategyOptions {
  /**
   * Streams the request when LOFT asks for events. Default true. With false the request is sent without streaming,
   * and LOFT sends the reply text once the call returns.
   */
  streaming?: boolean;
  /**
   * Asks the API to send the usage at the end of a stream (`stream_options.include_usage`). Default true. With false
   * the usage of a streamed request is unknown, and token accounting falls back to 500 tokens.
   */
  streamUsage?: boolean;
  /** Passed to the SDK client. */
  clientOptions?: {
    /** Request timeout in ms (SDK default: 10 minutes). */
    timeout?: number;
    /** Retries of the SDK itself (SDK default: 2). */
    maxRetries?: number;
  };
}
