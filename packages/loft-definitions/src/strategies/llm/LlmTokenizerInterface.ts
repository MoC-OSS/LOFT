export interface LlmTokenizer {
  calculateTokensFromString: (message: string) => number;
}
