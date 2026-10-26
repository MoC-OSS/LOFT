import Anthropic from '@anthropic-ai/sdk';
import { InteractiveOutputMessage, Logger, Strategy, Type } from '@moc-global/loft-definitions';

import { anthropicUsageToUnified } from './usage';

const log = new Logger('AnthropicStrategy');

/**
 * Options for converting Anthropic responses to unified format
 */
export interface ResponseConversionOptions {
  correlatorIds: string[];
  sessionId: string;
  manifestName: string;
  llmName: string;
}

/**
 * Converts Anthropic content block to unified content parts
 */
export function convertAnthropicContentBlockToUnifiedParts(
  contentBlock: Anthropic.ContentBlock
): Type.Entity.FullContentPart[] {
  const parts: Type.Entity.FullContentPart[] = [];

  switch (contentBlock.type) {
    case 'text':
      // Convert text content
      if (contentBlock.text) {
        parts.push({
          type: 'text',
          text: contentBlock.text
        } as Type.Entity.FullContentPart);
      }
      break;

    case 'tool_use':
      // Convert tool_use to tool_call
      parts.push({
        type: 'tool_call',
        callId: contentBlock.id,
        method: 'tools/call',
        params: {
          name: contentBlock.name,
          arguments: contentBlock.input || {}
        }
      } as Type.Entity.FullContentPart);
      break;

    case 'thinking':
    case 'redacted_thinking':
      // Not part of the answer; ThinkingCache keeps the blocks for the tool loop
      break;

    default:
      log.warn(`Unsupported Anthropic content block type: ${(contentBlock as any).type}`);
  }

  return parts;
}

/**
 * Converts Anthropic content blocks to a unified message
 */
export function convertAnthropicContentToUnifiedMessage(
  contentBlocks: Anthropic.ContentBlock[],
  options: ResponseConversionOptions
): InteractiveOutputMessage {
  const { sessionId, llmName, manifestName } = options;

  // Combine all content parts from all content blocks
  const allContentParts = contentBlocks.flatMap((block) => convertAnthropicContentBlockToUnifiedParts(block));

  // Extract citations if available, only include in ctx if defined
  const citations = contentBlocks.find((block) => block.type === 'text')?.citations;

  return new InteractiveOutputMessage({
    sessionId,
    ctx: citations ? { citations } : {},
    content: allContentParts,
    role: Type.LLM.UnifiedMessageRole.assistant,
    author: 'assistant',
    llmName,
    manifestName,
    llmIgnore: false
  });
}

/**
 * Formats the complete Anthropic response to unified LLM response format
 */
export function formatAnthropicResponseToUnified(
  responseContent: Anthropic.ContentBlock[],
  options: ResponseConversionOptions,
  originalResponse: Anthropic.Message
): Strategy.LLM.UnifiedLLMResponse {
  const unifiedMessage = convertAnthropicContentToUnifiedMessage(responseContent, options);

  // Extract usage in Anthropic format (always provide values, use 0 if missing)
  const usage: Strategy.LLM.UnifiedUsage = anthropicUsageToUnified(
    originalResponse.usage,
    originalResponse.model,
    originalResponse.stop_reason
  );

  return {
    choices: [unifiedMessage],
    topChoice: unifiedMessage,
    usage,
    originalResponse
  };
}
