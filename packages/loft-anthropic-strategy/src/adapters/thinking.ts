import Anthropic from '@anthropic-ai/sdk';
import { Type } from '@moc-global/loft-definitions';

// Claude's thinking is not part of its answer, but during a tool loop Anthropic expects the thinking blocks back, at
// the start of the assistant message that made the calls; the strategy keeps them in the first tool call's _meta
const META_KEY = 'anthropicThinking';

type ThinkingBlockParam = Anthropic.ThinkingBlockParam | Anthropic.RedactedThinkingBlockParam;
type ToolCallPart = Type.Entity.FullContentPart & { type: 'tool_call' };

const isToolCall = (part: Type.Entity.FullContentPart): part is ToolCallPart => part.type === 'tool_call';

/**
 * Keeps the thinking blocks of a response on its first tool call; without a tool call nothing sends them back
 */
export function keepThinkingOnToolCall(contentBlocks: Anthropic.ContentBlock[], parts: Type.Entity.FullContentPart[]) {
  const thinking: ThinkingBlockParam[] = contentBlocks.flatMap((block): ThinkingBlockParam[] => {
    if (block.type === 'thinking') {
      return [{ type: 'thinking', thinking: block.thinking, signature: block.signature }];
    }
    if (block.type === 'redacted_thinking') {
      return [{ type: 'redacted_thinking', data: block.data }];
    }
    return [];
  });
  const firstToolCall = parts.find(isToolCall);
  if (thinking.length > 0 && firstToolCall) {
    firstToolCall._meta = { ...firstToolCall._meta, [META_KEY]: thinking };
  }
}

/**
 * Reads back the thinking blocks kept on the tool calls of an assistant message
 */
export function thinkingBlocksFromContent(parts: Type.Entity.FullContentPart[]): ThinkingBlockParam[] {
  return parts.filter(isToolCall).flatMap((part) => {
    const thinking = part._meta?.[META_KEY];
    return Array.isArray(thinking) ? (thinking as ThinkingBlockParam[]) : [];
  });
}
