import { Logger, Strategy } from '@moc-global/loft-definitions';

import { AnthropicResponseChunk } from './AnthropicTypes';

const log = new Logger('AnthropicStrategy');

/**
 * @deprecated Use chat.generate({ onEvent }) instead.
 * Removed in the next major release.
 */
export class AnthropicStream extends Strategy.LLM.UnifiedLLMStream {
  constructor() {
    super();
  }

  formatResponse(originalResponse: Buffer): Strategy.LLM.UnifiedLLMChunkResponse {
    const responseChunk = originalResponse.toString();
    try {
      const anthropicResponseChunk = JSON.parse(responseChunk) as AnthropicResponseChunk;

      // Handle different event types from Anthropic SSE stream
      switch (anthropicResponseChunk.type) {
        case 'content_block_delta':
          if (anthropicResponseChunk.delta.type === 'text_delta') {
            return {
              chunk: {
                content: [
                  {
                    type: 'text',
                    text: anthropicResponseChunk.delta.text || ''
                  }
                ],
                author: 'assistant'
              },
              originalResponse: anthropicResponseChunk
            };
          }
          // Handle other delta types (thinking_delta, input_json_delta, citations_delta, signature_delta)
          return {
            chunk: {
              content: [],
              author: 'assistant'
            },
            originalResponse: anthropicResponseChunk
          };

        case 'message_delta':
          // Message delta may contain stop reason but no content
          return {
            chunk: {
              content: [],
              author: 'assistant'
            },
            originalResponse: anthropicResponseChunk
          };

        case 'content_block_start':
          // Handle the start of a content block
          if (anthropicResponseChunk.content_block.type === 'text') {
            return {
              chunk: {
                content: [
                  {
                    type: 'text',
                    text: anthropicResponseChunk.content_block.text || ''
                  }
                ],
                author: 'assistant'
              },
              originalResponse: anthropicResponseChunk
            };
          }
          // Handle other content block types (tool_use, thinking, redacted_thinking)
          return {
            chunk: {
              content: [],
              author: 'assistant'
            },
            originalResponse: anthropicResponseChunk
          };

        case 'content_block_stop':
          // Handle the end of a content block
          return {
            chunk: {
              content: [],
              author: 'assistant'
            },
            originalResponse: anthropicResponseChunk
          };

        case 'message_start':
          // Handle the start of a message
          return {
            chunk: {
              content: [],
              author: 'assistant'
            },
            originalResponse: anthropicResponseChunk
          };

        case 'message_stop':
          // Handle the end of a message
          return {
            chunk: {
              content: [],
              author: 'assistant'
            },
            originalResponse: anthropicResponseChunk
          };

        default:
          // Default empty response for other event types
          return {
            chunk: {
              content: [],
              author: 'assistant'
            },
            originalResponse: anthropicResponseChunk
          };
      }
    } catch (error) {
      log.error('formatResponse failed', error);
      throw error;
    }
  }
}
