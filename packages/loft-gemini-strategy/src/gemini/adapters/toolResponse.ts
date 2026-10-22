import type { FunctionCall } from '@google/genai';
import { Type, Util } from '@moc-global/loft-definitions';

import { functionCallIdMeta } from './functionCallId';
import { thoughtSignatureMeta } from './thoughtSignature';

/**
 * Converts a Gemini FunctionCall to unified tool_call content part. The call keeps the id Gemini gave it; a call
 * without one gets a LOFT id that carries the tool name (`<name>:::<random>`).
 */
export function convertGeminiFunctionCallToUnifiedToolCall(
  functionCall: FunctionCall,
  thoughtSignature?: string
): Type.Entity.FullContentPart {
  const meta = { ...thoughtSignatureMeta(thoughtSignature)._meta, ...functionCallIdMeta(functionCall.id)._meta };

  return {
    type: 'tool_call',
    callId: functionCall.id || Util.generateToolCallId(functionCall.name || 'unknown'),
    method: 'tools/call',
    ...(Object.keys(meta).length > 0 && { _meta: meta }),
    params: {
      name: functionCall.name || '',
      arguments: functionCall.args || {}
    }
  } as Type.Entity.FullContentPart;
}
