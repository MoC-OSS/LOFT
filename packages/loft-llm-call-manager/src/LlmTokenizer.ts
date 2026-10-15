import { encoding_for_model } from '@dqbd/tiktoken';
import { Strategy } from '@moc-global/loft-definitions';

export class LlmTokenizer implements Strategy.LLM.LlmTokenizer {
  calculateTokensFromString(message: string) {
    const encoder = encoding_for_model('gpt-3.5-turbo');

    try {
      const tokens = encoder.encode(message);
      return Math.ceil(tokens.length + 0.1 * tokens.length);
    } finally {
      encoder.free();
    }
  }
}
