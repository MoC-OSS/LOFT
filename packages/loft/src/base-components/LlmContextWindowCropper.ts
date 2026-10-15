import { Interface, Logger, Strategy, Type } from '@moc-global/loft-definitions';
import { injectable } from 'inversify';

type ChatHistoryMessage = Interface.FacadeEntity.Message | Interface.FacadeEntity.InteractiveOutputMessage;

/**
 * Result of the safe crop point analysis
 */
interface SafeCropResult {
  /** Index from which to start cropping (inclusive) */
  startIndex: number;
  /** Number of messages that will be included after cropping */
  includedCount: number;
  /** Whether the crop point was adjusted from the target to maintain integrity */
  wasAdjusted: boolean;
  /** Reason for adjustment if any */
  adjustmentReason?: string;
}

/**
 * Implementation of LLM context window cropping strategy
 * Safely crops chat history while maintaining tool chain integrity
 */
@injectable()
export class LlmContextWindowCropper implements Strategy.LlmContextWindowCropper {
  private readonly logger = new Logger('LlmContextWindowCropper');

  constructor() {}

  /**
   * Crop chat history messages to fit within the target size
   */
  crop(messages: ChatHistoryMessage[], targetSize: number): ChatHistoryMessage[] {
    // If targetSize is 0 or less, return all messages without cropping
    if (targetSize <= 0 || messages.length <= targetSize) {
      this.logger.debug('No cropping needed', {
        totalMessages: messages.length,
        targetSize
      });
      return [...messages]; // Return a new array copy
    }

    const cropResult = this.findSafeCropPoint(messages, targetSize);
    const croppedMessages = messages.slice(cropResult.startIndex);

    // Log cropping details
    const logLevel = cropResult.wasAdjusted ? 'warn' : 'debug';
    this.logger[logLevel]('Chat history cropped', {
      originalCount: messages.length,
      targetSize,
      actualCount: cropResult.includedCount,
      startIndex: cropResult.startIndex,
      wasAdjusted: cropResult.wasAdjusted,
      adjustmentReason: cropResult.adjustmentReason
    });

    // Validate the cropped result for tool chain integrity
    this.validateCroppedResult(croppedMessages);

    return croppedMessages;
  }

  /**
   * Find safe crop point that maintains tool chain integrity
   */
  private findSafeCropPoint(messages: ChatHistoryMessage[], targetSize: number): SafeCropResult {
    // This method should only be called when targetSize > 0 and cropping is needed
    // The check is already done in crop() method

    // No cropping needed
    if (messages.length <= targetSize) {
      return {
        startIndex: 0,
        includedCount: messages.length,
        wasAdjusted: false
      };
    }

    // Try to keep exactly targetSize newest messages
    const idealStartIndex = messages.length - targetSize;

    // Search backward from ideal point to find safe crop point
    // This only increases the number of kept messages, never decreases
    for (let candidateIndex = idealStartIndex; candidateIndex >= 0; candidateIndex--) {
      const validation = this.validateSafeStartPoint(messages, candidateIndex);

      if (validation.valid) {
        const includedCount = messages.length - candidateIndex;
        return {
          startIndex: candidateIndex,
          includedCount,
          wasAdjusted: candidateIndex !== idealStartIndex,
          adjustmentReason:
            candidateIndex !== idealStartIndex
              ? `Increased from ${targetSize} to ${includedCount} messages to maintain tool chain integrity`
              : undefined
        };
      }
    }

    // Emergency case: no safe crop point found - even startIndex=0 is unsafe
    // This indicates dangerous scenarios like: all messages are tool messages,
    // or conversation starts with unsafe message types
    this.logger.warn('EMERGENCY: No safe crop point found in chat history', {
      totalMessages: messages.length,
      targetSize,
      idealStartIndex,
      warningDetails:
        'Even starting from index 0 would break tool chain integrity. Keeping all messages to prevent data loss.'
    });

    return {
      startIndex: 0,
      includedCount: messages.length,
      wasAdjusted: true,
      adjustmentReason: `EMERGENCY: No safe crop point found - even startIndex=0 unsafe. Keeping all ${messages.length} messages to prevent tool chain corruption.`
    };
  }

  /**
   * Simplified validation - checks if we can safely start cropping at given index
   *
   * Safe start points:
   * ✅ User: always safe (natural conversation boundary)
   * ✅ Assistant without tools: safe (completed response, even after Tool)
   * ✅ System: usually safe
   * ❌ Assistant with tools: unsafe (would leave orphaned tool_calls)
   * ❌ Tool: unsafe (would be orphaned result)
   */
  private validateSafeStartPoint(
    messages: ChatHistoryMessage[],
    startIndex: number
  ): { valid: boolean; reason?: string } {
    if (startIndex < 0) return { valid: false, reason: 'Index out of bounds (negative)' };
    if (startIndex >= messages.length) return { valid: false, reason: 'Index out of bounds' };

    const messageAtIndex = messages[startIndex];

    switch (messageAtIndex.role) {
      case Type.LLM.UnifiedMessageRole.user:
        return { valid: true }; // ✅ User = always safe

      case Type.LLM.UnifiedMessageRole.assistant:
        // Check if assistant has tool_calls
        if (this.messageHasToolCalls(messageAtIndex)) {
          // ❌ Assistant with tools = unsafe (may leave orphaned tool_calls)
          return { valid: false, reason: 'Cannot start crop before assistant with tool_calls' };
        }
        // ✅ Assistant without tools = safe (completed response, even after Tool)
        return { valid: true };

      case Type.LLM.UnifiedMessageRole.tool:
        // ❌ Tool = always unsafe (orphaned result)
        return { valid: false, reason: 'Cannot start crop before tool message (orphaned result)' };

      case Type.LLM.UnifiedMessageRole.system:
        return { valid: true }; // ✅ System = usually safe

      default:
        return { valid: false, reason: `Unsupported role: ${messageAtIndex.role}` };
    }
  }

  /**
   * Checks if a message contains tool_calls in its content
   */
  private messageHasToolCalls(message: ChatHistoryMessage): boolean {
    if (!message.content || !Array.isArray(message.content)) {
      return false;
    }

    return message.content.some((content: any) => content.type === 'tool_call');
  }

  /**
   * Validates the integrity of tool chains in cropped messages
   * Logs warnings for any detected issues without affecting the cropping result
   *
   * TODO: Consider extracting this validation logic into a separate component
   * to:
   * - Separate concerns (cropping vs validation)
   * - Move validation call to LlmManager after crop() invocation
   */
  private validateCroppedResult(messages: ChatHistoryMessage[]): void {
    if (messages.length === 0) {
      return;
    }

    // Check for orphaned tool message at the beginning
    const firstMessage = messages[0];
    if (firstMessage.role === Type.LLM.UnifiedMessageRole.tool) {
      this.logger.warn('Cropped result starts with orphaned tool message', {
        firstMessageId: firstMessage.id,
        firstMessageRole: firstMessage.role,
        issue: 'Tool message without preceding tool_call'
      });
    }

    // Check for incomplete tool chain at the end
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === Type.LLM.UnifiedMessageRole.assistant && this.messageHasToolCalls(lastMessage)) {
      this.logger.warn('Cropped result ends with incomplete tool chain', {
        lastMessageId: lastMessage.id,
        lastMessageRole: lastMessage.role,
        issue: 'Assistant message with tool_calls but no corresponding tool results'
      });
    }

    // Count tool calls and tool results (not all have IDs to track)
    let toolCallCount = 0;
    let toolResultCount = 0;

    for (const message of messages) {
      if (message.role === Type.LLM.UnifiedMessageRole.assistant && message.content && Array.isArray(message.content)) {
        for (const content of message.content) {
          if (content.type === 'tool_call') {
            toolCallCount++;
          }
        }
      } else if (
        message.role === Type.LLM.UnifiedMessageRole.tool &&
        message.content &&
        Array.isArray(message.content)
      ) {
        for (const content of message.content) {
          if (content.type === 'tool_result') {
            toolResultCount++;
          }
        }
      }
    }

    // Check general balance between calls and results
    if (toolCallCount !== toolResultCount) {
      this.logger.warn('Tool chain imbalance detected', {
        toolCallCount,
        toolResultCount,
        difference: toolCallCount - toolResultCount,
        issue:
          toolCallCount > toolResultCount
            ? 'More tool calls than results - some calls may be missing responses'
            : 'More tool results than calls - some results may be orphaned'
      });
    }
  }
}
