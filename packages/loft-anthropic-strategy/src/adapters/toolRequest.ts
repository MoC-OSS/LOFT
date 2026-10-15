import Anthropic from '@anthropic-ai/sdk';
import { Type } from '@moc-global/loft-definitions';

/**
 * Converts unified tool_call content parts to Anthropic tool_use format
 */
export function convertUnifiedToolCallToAnthropicToolUse(
  toolCall: Type.Entity.FullContentPart & { type: 'tool_call' }
): Anthropic.ToolUseBlockParam {
  return {
    type: 'tool_use',
    id: toolCall.callId || `tool_${Date.now()}`,
    name: toolCall.params?.name || '',
    input: toolCall.params?.arguments || {}
  };
}

/**
 * Extracts tool calls from unified content parts and converts them to Anthropic format
 */
export function extractToolCallsFromContent(parts: Type.Entity.FullContentPart[]): Array<Anthropic.ToolUseBlockParam> {
  return parts
    .filter((part): part is Type.Entity.FullContentPart & { type: 'tool_call' } => part.type === 'tool_call')
    .map(convertUnifiedToolCallToAnthropicToolUse);
}
