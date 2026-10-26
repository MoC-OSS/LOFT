import type { GenerateContentResponse } from '@google/genai';
import { InteractiveOutputMessage, Strategy, Type } from '@moc-global/loft-definitions';

import { thoughtSignatureField, thoughtSignatureMeta } from './thoughtSignature';
import { convertGeminiFunctionCallToUnifiedToolCall } from './toolResponse';
import { geminiUsageToUnified } from './usage';

export interface ResponseConversionOptions {
  correlatorIds: string[];
  sessionId: string;
  manifestName: string;
  llmName: string;
}

/**
 * Converts Gemini response content to unified content parts
 */
function convertGeminiContentToUnifiedParts(response: GenerateContentResponse): Type.Entity.FullContentPart[] {
  const parts: Type.Entity.FullContentPart[] = [];
  const candidates = response.candidates || [];

  if (candidates.length === 0 || !candidates[0].content?.parts) {
    return parts;
  }

  // A signature can come on a part that is not kept, such as a thought summary or an empty final text part; it moves to
  // the next kept part, or to the last one when none follows
  let pendingSignature: string | undefined;

  for (const part of candidates[0].content.parts) {
    const thoughtSignature = part.thoughtSignature ?? pendingSignature;

    if (part.functionCall) {
      parts.push(convertGeminiFunctionCallToUnifiedToolCall(part.functionCall, thoughtSignature));
      pendingSignature = undefined;
    } else if (part.text && !part.thought) {
      // A thought summary (includeThoughts) is the model's reasoning, not its answer
      parts.push({
        type: 'text',
        text: part.text,
        ...thoughtSignatureMeta(thoughtSignature)
      } as Type.Entity.TextContent);
      pendingSignature = undefined;
    } else if (part.thoughtSignature) {
      pendingSignature = part.thoughtSignature;
    }
  }

  const lastPart = parts.at(-1);
  if (pendingSignature && lastPart && !thoughtSignatureField(lastPart).thoughtSignature) {
    lastPart._meta = { ...lastPart._meta, ...thoughtSignatureMeta(pendingSignature)._meta };
  }

  return parts;
}

/**
 * Converts Gemini response to unified message
 */
function convertGeminiResponseToUnifiedMessage(
  response: GenerateContentResponse,
  options: ResponseConversionOptions
): InteractiveOutputMessage {
  const { sessionId, llmName, manifestName } = options;
  const contentParts = convertGeminiContentToUnifiedParts(response);

  return new InteractiveOutputMessage({
    sessionId,
    ctx: {},
    content: contentParts,
    role: Type.LLM.UnifiedMessageRole.assistant,
    author: 'model',
    llmName,
    manifestName,
    llmIgnore: false
  });
}

/**
 * Formats the complete Gemini response to unified LLM response format
 */
export function formatGeminiResponseToUnified(
  response: GenerateContentResponse,
  options: ResponseConversionOptions
): Strategy.LLM.UnifiedLLMResponse {
  const unifiedMessage = convertGeminiResponseToUnifiedMessage(response, options);

  const usage: Strategy.LLM.UnifiedUsage = geminiUsageToUnified(
    response.usageMetadata,
    response.modelVersion,
    response.candidates?.[0]?.finishReason
  );

  return {
    choices: [unifiedMessage],
    topChoice: unifiedMessage,
    usage,
    originalResponse: response
  };
}
