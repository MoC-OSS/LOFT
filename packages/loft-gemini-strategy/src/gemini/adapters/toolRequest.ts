import type { Part } from '@google/genai';
import { Type, Util } from '@moc-global/loft-definitions';

import { thoughtSignatureField } from './thoughtSignature';

/**
 * Converts a unified tool_call content part to Gemini functionCall part
 */
function convertUnifiedToolCallToGeminiFunctionCall(
  toolCall: Type.Entity.FullContentPart & { type: 'tool_call' }
): Part {
  return {
    functionCall: {
      name: toolCall.params?.name || '',
      args: toolCall.params?.arguments || {}
    },
    ...thoughtSignatureField(toolCall)
  };
}

/**
 * Converts a unified tool_result content part to Gemini functionResponse part
 */
function convertUnifiedToolResultToGeminiFunctionResponse(
  toolResult: Type.Entity.FullContentPart & { type: 'tool_result' }
): Part {
  // Extract the result content
  let responseContent: Record<string, unknown> = {};

  if (toolResult.content && Array.isArray(toolResult.content)) {
    // If content is an array, extract text content
    const textContent = toolResult.content
      .filter((item): item is Type.Entity.TextContent => item.type === 'text')
      .map((item) => item.text)
      .join('\n');

    // Gemini reads the `error` key as the function's error details
    responseContent = toolResult.isError ? { error: textContent } : { result: textContent };
  } else if (typeof toolResult.content === 'string') {
    responseContent = { result: toolResult.content };
  }

  // Parse tool name from callId (format: {toolName}:::{random})
  const toolName = Util.parseToolNameFromToolCallId(toolResult.callId || '');

  return {
    functionResponse: {
      name: toolName || 'unknown',
      response: responseContent
    }
  };
}

/**
 * Extracts tool calls from unified content parts and converts to Gemini format
 */
export function extractToolCallsFromContent(parts: Type.Entity.FullContentPart[]): Part[] {
  return parts
    .filter((part): part is Type.Entity.FullContentPart & { type: 'tool_call' } => part.type === 'tool_call')
    .map(convertUnifiedToolCallToGeminiFunctionCall);
}

/**
 * Extracts tool results from unified content parts and converts to Gemini format
 */
export function extractToolResultsFromContent(parts: Type.Entity.FullContentPart[]): Part[] {
  return parts
    .filter((part): part is Type.Entity.FullContentPart & { type: 'tool_result' } => part.type === 'tool_result')
    .map(convertUnifiedToolResultToGeminiFunctionResponse);
}
