/**
 * @experimental
 * Options of `AnthropicCallStrategy`, passed as its last constructor argument.
 */
export interface AnthropicStrategyOptions {
  /**
   * Streams the request when LOFT asks for events. Default true. With false the request is sent without streaming,
   * and LOFT sends the reply text once the call returns.
   */
  streaming?: boolean;
}
