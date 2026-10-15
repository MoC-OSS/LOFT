import type { FunctionCall } from '@google/genai';
import { Type, Util } from '@moc-global/loft-definitions';

import { thoughtSignatureMeta } from './thoughtSignature';

/**
 * Converts a Gemini FunctionCall to unified tool_call content part
 */
export function convertGeminiFunctionCallToUnifiedToolCall(
  functionCall: FunctionCall,
  thoughtSignature?: string
): Type.Entity.FullContentPart {
  return {
    type: 'tool_call',
    callId: Util.generateToolCallId(functionCall.name || 'unknown'),
    method: 'tools/call',
    ...thoughtSignatureMeta(thoughtSignature),
    params: {
      name: functionCall.name || '',
      arguments: functionCall.args || {}
    }
  } as Type.Entity.FullContentPart;
}
