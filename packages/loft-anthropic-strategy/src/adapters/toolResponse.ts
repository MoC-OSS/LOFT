import Anthropic from '@anthropic-ai/sdk';
import { Type } from '@moc-global/loft-definitions';

/**
 * Converts Anthropic tool_use block to unified tool_call content part
 */
export function convertAnthropicToolUseToUnifiedToolCall(
  toolUse: Anthropic.ContentBlock & { type: 'tool_use' }
): Type.Entity.FullContentPart {
  return {
    type: 'tool_call',
    callId: toolUse.id,
    method: 'tools/call',
    params: {
      name: toolUse.name,
      arguments: toolUse.input || {}
    }
  } as Type.Entity.FullContentPart;
}

/**
 * Converts Anthropic tool_result block to unified tool_result content part
 */
export function convertAnthropicToolResultToUnifiedToolResult(toolResult: any): Type.Entity.FullContentPart {
  return {
    type: 'tool_result',
    callId: toolResult.tool_use_id,
    content: [
      {
        type: 'text',
        text: typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content)
      }
    ]
  } as Type.Entity.FullContentPart;
}

/**
 * Extracts tool uses from Anthropic content blocks
 */
export function extractToolUsesFromContent(contentBlocks: Anthropic.ContentBlock[]): Type.Entity.FullContentPart[] {
  return contentBlocks
    .filter((block): block is Anthropic.ContentBlock & { type: 'tool_use' } => block.type === 'tool_use')
    .map(convertAnthropicToolUseToUnifiedToolCall);
}

/**
 * Extracts tool results from Anthropic content blocks
 */
export function extractToolResultsFromContent(contentBlocks: Anthropic.ContentBlock[]): Type.Entity.FullContentPart[] {
  return contentBlocks
    .filter((block) => (block as any).type === 'tool_result')
    .map((block) => convertAnthropicToolResultToUnifiedToolResult(block as any));
}
