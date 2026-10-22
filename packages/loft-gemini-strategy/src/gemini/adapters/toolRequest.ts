import type { Part } from '@google/genai';
import { Type, Util } from '@moc-global/loft-definitions';

import { functionCallIdField } from './functionCallId';
import { thoughtSignatureField } from './thoughtSignature';

// The separator of a LOFT callId, `<tool name>:::<random>`
const LOFT_ID_SEPARATOR = ':::';

type ToolCallPart = Type.Entity.FullContentPart & { type: 'tool_call' };
type ToolResultPart = Type.Entity.FullContentPart & { type: 'tool_result' };

/**
 * The tool calls of a conversation by their callId, so each tool result finds the tool name and Gemini id of its call
 * @experimental
 */
export type ToolCallsById = ReadonlyMap<string, ToolCallPart>;

/**
 * Converts a unified tool_call content part to Gemini functionCall part
 */
function convertUnifiedToolCallToGeminiFunctionCall(toolCall: ToolCallPart): Part {
  return {
    functionCall: {
      ...functionCallIdField(toolCall),
      name: toolCall.params?.name || '',
      args: toolCall.params?.arguments || {}
    },
    ...thoughtSignatureField(toolCall)
  };
}

/**
 * Converts a unified tool_result content part to Gemini functionResponse part
 */
function convertUnifiedToolResultToGeminiFunctionResponse(toolResult: ToolResultPart, toolCalls?: ToolCallsById): Part {
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

  // The name of the call the result answers; without the call, parsed from a LOFT callId (format: {toolName}:::{random}).
  // Another id (Gemini's, another provider's) does not carry the name
  const callId = toolResult.callId || '';
  const toolCall = callId ? toolCalls?.get(callId) : undefined;
  const toolName =
    toolCall?.params?.name ||
    (callId.includes(LOFT_ID_SEPARATOR) ? Util.parseToolNameFromToolCallId(callId) : undefined);

  return {
    functionResponse: {
      // Gemini matches a response to its call by the id it gave the call
      ...(toolCall && functionCallIdField(toolCall)),
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
    .filter((part): part is ToolCallPart => part.type === 'tool_call')
    .map(convertUnifiedToolCallToGeminiFunctionCall);
}

/**
 * Extracts tool results from unified content parts and converts to Gemini format. With the conversation's tool calls,
 * each response carries the name and the Gemini id of its call.
 */
export function extractToolResultsFromContent(parts: Type.Entity.FullContentPart[], toolCalls?: ToolCallsById): Part[] {
  return parts
    .filter((part): part is ToolResultPart => part.type === 'tool_result')
    .map((part) => convertUnifiedToolResultToGeminiFunctionResponse(part, toolCalls));
}
