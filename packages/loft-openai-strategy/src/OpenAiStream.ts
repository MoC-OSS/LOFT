import { Logger, Strategy } from '@moc-global/loft-definitions';

import { OpenAiResponseChunk } from './OpenAiTypes';

const log = new Logger('OpenAIStrategy');

export class OpenAiStream extends Strategy.LLM.UnifiedLLMStream {
  constructor() {
    super();
  }

  formatResponse(originalResponse: Buffer): Strategy.LLM.UnifiedLLMChunkResponse {
    const responseChunk = originalResponse.toString();
    try {
      const openAiResponseChunk = JSON.parse(responseChunk) as OpenAiResponseChunk;
      return {
        chunk: {
          content: [
            {
              type: 'text',
              text: openAiResponseChunk.choices[0]?.delta?.content || ''
            }
          ],
          author: openAiResponseChunk.choices[0]?.delta?.role || 'assistant'
        },
        originalResponse: openAiResponseChunk
      };
    } catch (error) {
      log.error('formatResponse failed', error);
      throw error;
    }
  }
}
