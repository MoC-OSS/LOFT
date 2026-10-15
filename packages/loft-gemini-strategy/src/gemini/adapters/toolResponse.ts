import type { FunctionCall } from '@google/genai';
import { Type, Util } from '@moc-global/loft-definitions';

/**
 * Converts a Gemini FunctionCall to unified tool_call content part
 */
export function convertGeminiFunctionCallToUnifiedToolCall(functionCall: FunctionCall): Type.Entity.FullContentPart {
  return {
    type: 'tool_call',
    callId: Util.generateToolCallId(functionCall.name || 'unknown'),
    method: 'tools/call',
    params: {
      name: functionCall.name || '',
      arguments: functionCall.args || {}
    }
  } as Type.Entity.FullContentPart;
}
