import { Interface, Logger, Type } from '@moc-global/loft-definitions';

const log = new Logger('ToolValidation');

// Tool message used in usedTools array from LLM response
export type UsedToolMessage = Interface.FacadeEntity.InteractiveOutputMessage & {
  role: Type.LLM.UnifiedMessageRole.assistant | Type.LLM.UnifiedMessageRole.tool;
};

/**
 * Validates that every tool call has a result. Counts tool_call and tool_result parts, not messages:
 * one assistant message with N parallel calls is answered by N tool messages.
 * @param usedTools Array of tool messages to validate
 * @returns true if integrity is valid, false otherwise
 */
export function validateToolsIntegrity(usedTools: UsedToolMessage[]): boolean {
  const { isValid, summary } = createToolChainDiagnostic(usedTools);

  if (isValid) {
    log.debug(`Tool integrity valid - ${summary}`);
  } else {
    log.error(`Tool consistency/integrity violation: ${summary}. ChatHistory tools messages saving blocked.`);
  }
  return isValid;
}

/**
 * Logs detailed information about the tool call stack for debugging
 * @param toolChain Array of tool messages to analyze
 * @param context Context description for the log
 */
export function logToolCallStack(toolChain: UsedToolMessage[], context: string): void {
  const toolCalls = toolChain.filter((msg) => msg.role === Type.LLM.UnifiedMessageRole.assistant);
  const toolResults = toolChain.filter((msg) => msg.role === Type.LLM.UnifiedMessageRole.tool);

  log.error(`Tool Call Stack Analysis - ${context}`, {
    totalMessages: toolChain.length,
    toolCalls: toolCalls.length,
    toolResults: toolResults.length,
    isBalanced: toolCalls.length === toolResults.length,
    chainSequence: toolChain.map((msg, index) => ({
      index,
      role: msg.role,
      messageId: msg.id,
      author: msg.author,
      contentLength: msg.content?.length || 0
    })),
    toolCallDetails: toolCalls.map((msg) => ({
      messageId: msg.id,
      author: msg.author,
      toolCallsInMessage: msg.content?.filter((c: any) => c.type === 'tool_call').length || 0
    })),
    toolResultDetails: toolResults.map((msg) => ({
      messageId: msg.id,
      author: msg.author,
      toolResultsInMessage: msg.content?.filter((c: any) => c.type === 'tool_result').length || 0,
      hasErrors: msg.content?.some((c: any) => c.type === 'tool_result' && c.isError) || false
    }))
  });
}

/**
 * Creates a detailed diagnostic report of tool chain state
 * @param toolChain Array of tool messages to analyze
 * @returns Diagnostic information object
 */
export function createToolChainDiagnostic(toolChain: UsedToolMessage[]): {
  isValid: boolean;
  summary: string;
  details: {
    totalMessages: number;
    assistantMessages: number;
    toolMessages: number;
    lastMessageRole: string;
    sequenceValid: boolean;
    ignoredMessagesCount: number;
  };
} {
  // Filter out messages marked as llmIgnore: true since they don't participate in tool execution
  const activeChain = toolChain.filter((msg) => !(msg as any).llmIgnore);
  const ignoredMessagesCount = toolChain.length - activeChain.length;

  const assistantMessages = activeChain.filter((msg) => msg.role === Type.LLM.UnifiedMessageRole.assistant);
  const toolMessages = activeChain.filter((msg) => msg.role === Type.LLM.UnifiedMessageRole.tool);

  // Count actual tool calls and tool results, not messages
  const totalToolCalls = assistantMessages.reduce((count, msg) => {
    const toolCallsInMessage = msg.content?.filter((c: any) => c.type === 'tool_call').length || 0;
    return count + toolCallsInMessage;
  }, 0);

  const totalToolResults = toolMessages.reduce((count, msg) => {
    const toolResultsInMessage = msg.content?.filter((c: any) => c.type === 'tool_result').length || 0;
    return count + toolResultsInMessage;
  }, 0);

  const isBalanced = totalToolCalls === totalToolResults;
  const lastMessage = activeChain[activeChain.length - 1];
  const lastMessageRole = lastMessage?.role || 'none';

  // Check sequence validity: should alternate assistant -> tool (if any tools exist)
  let sequenceValid = true;
  if (activeChain.length > 0) {
    for (let i = 0; i < activeChain.length - 1; i++) {
      const current = activeChain[i];
      const next = activeChain[i + 1];

      if (
        current.role === Type.LLM.UnifiedMessageRole.assistant &&
        next.role === Type.LLM.UnifiedMessageRole.assistant
      ) {
        // Two consecutive assistant messages - only valid if the first has no tool calls
        const hasToolCalls = current.content?.some((c: any) => c.type === 'tool_call') || false;
        if (hasToolCalls) {
          sequenceValid = false;
          break;
        }
      }
    }
  }

  const isValid = isBalanced && sequenceValid;
  const summary = isValid
    ? `Valid tool chain: ${totalToolCalls} calls, ${totalToolResults} results`
    : `Invalid tool chain: ${totalToolCalls} calls, ${totalToolResults} results, sequence valid: ${sequenceValid}`;

  return {
    isValid,
    summary,
    details: {
      totalMessages: activeChain.length,
      assistantMessages: assistantMessages.length,
      toolMessages: toolMessages.length,
      lastMessageRole,
      sequenceValid,
      ignoredMessagesCount
    }
  };
}
