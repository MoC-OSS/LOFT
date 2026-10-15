import { Logger, Strategy } from '@moc-global/loft-definitions';

import { GeminiStreamChunk } from '../VertexAiTypes';

const log = new Logger('GeminiStrategy');

export class GeminiStream extends Strategy.LLM.UnifiedLLMStream {
  constructor() {
    super();
  }

  formatResponse(originalResponse: Buffer): Strategy.LLM.UnifiedLLMChunkResponse {
    const responseChunk = originalResponse.toString();
    try {
      const geminiResponseChunk = JSON.parse(responseChunk) as GeminiStreamChunk;

      // Extract text from the response using the new SDK format
      const textContent =
        geminiResponseChunk.candidates?.[0]?.content?.parts
          ?.map((part) => part.text || '')
          .filter(Boolean)
          .join('') || '';

      return {
        chunk: {
          content: [{ type: 'text', text: textContent }],
          author: 'model'
        },
        originalResponse: geminiResponseChunk
      };
    } catch (error) {
      log.error('formatResponse failed', error);
      throw error;
    }
  }
}
