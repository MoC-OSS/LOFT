import Anthropic from '@anthropic-ai/sdk';
import { Type } from '@moc-global/loft-definitions';

export type ThinkingBlockParam = Anthropic.ThinkingBlockParam | Anthropic.RedactedThinkingBlockParam;

const isToolCall = (part: Type.Entity.FullContentPart): part is Type.Entity.FullContentPart & { type: 'tool_call' } =>
  part.type === 'tool_call';

/**
 * Claude's thinking is not part of its answer, but during a tool loop Anthropic takes the thinking blocks back, at the
 * start of the assistant message that made the calls, to keep the reasoning going. The loop runs inside one generate
 * call, so the blocks are kept here, under the id of the response's first tool call, and never reach the message
 * content that LOFT returns and saves. A request whose blocks are no longer here is sent without them, which Anthropic
 * accepts.
 */
export class ThinkingCache {
  private readonly blocks = new Map<string, ThinkingBlockParam[]>();

  constructor(private readonly maxEntries = 1000) {}

  /**
   * Keeps the thinking blocks of a response that calls tools
   */
  keep(contentBlocks: Anthropic.ContentBlock[]): void {
    const toolUse = contentBlocks.find((block) => block.type === 'tool_use');
    const thinking = contentBlocks.flatMap((block): ThinkingBlockParam[] => {
      if (block.type === 'thinking') {
        return [{ type: 'thinking', thinking: block.thinking, signature: block.signature }];
      }
      if (block.type === 'redacted_thinking') {
        return [{ type: 'redacted_thinking', data: block.data }];
      }
      return [];
    });
    if (!toolUse || thinking.length === 0) return;

    this.blocks.set(toolUse.id, thinking);
    if (this.blocks.size > this.maxEntries) {
      // A Map iterates in insertion order, so the first key is the oldest
      this.blocks.delete(this.blocks.keys().next().value as string);
    }
  }

  /**
   * The thinking blocks of an assistant message, found by its first tool call
   */
  forMessage(parts: Type.Entity.FullContentPart[]): ThinkingBlockParam[] {
    const callId = parts.find(isToolCall)?.callId;
    return (callId && this.blocks.get(callId)) || [];
  }
}
