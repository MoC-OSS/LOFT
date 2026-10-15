import type { GenerateContentResponse } from '@google/genai';
import { InteractiveOutputMessage, Strategy, Type } from '@moc-global/loft-definitions';

import { thoughtSignatureMeta } from './thoughtSignature';
import { convertGeminiFunctionCallToUnifiedToolCall } from './toolResponse';

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

  for (const part of candidates[0].content.parts) {
    // A thought summary (includeThoughts) is the model's reasoning, not its answer
    if (part.text && !part.thought) {
      parts.push({
        type: 'text',
        text: part.text,
        ...thoughtSignatureMeta(part.thoughtSignature)
      } as Type.Entity.TextContent);
    }

    if (part.functionCall) {
      parts.push(convertGeminiFunctionCallToUnifiedToolCall(part.functionCall, part.thoughtSignature));
    }
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

  const usage: Strategy.LLM.UnifiedUsage = {
    inputTokens: response.usageMetadata?.promptTokenCount || 0,
    outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
    totalTokens: response.usageMetadata?.totalTokenCount || 0,
    model: response.modelVersion || undefined
  };

  return {
    choices: [unifiedMessage],
    topChoice: unifiedMessage,
    usage,
    originalResponse: response
  };
}
