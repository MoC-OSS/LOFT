import type { Content, Part } from '@google/genai';
import { Schema, Type } from '@moc-global/loft-definitions';

import { extractToolCallsFromContent, extractToolResultsFromContent } from './toolRequest';

/**
 * Extracts text from a content part
 */
function extractTextFromContentPart(part: Type.Entity.FullContentPart): string | null {
  switch (part.type) {
    case 'text':
      return part.text;
    case 'resource':
      if ('text' in part.resource && typeof part.resource.text === 'string') {
        return part.resource.text;
      }
      return null;
    default:
      return null;
  }
}

/**
 * Converts unified content parts to Gemini parts (text only)
 */
function convertContentPartsToGeminiTextParts(parts: Type.Entity.FullContentPart[]): Part[] {
  const geminiParts: Part[] = [];

  for (const part of parts) {
    if (part.type === 'tool_call' || part.type === 'tool_result') {
      continue;
    }

    const text = extractTextFromContentPart(part);
    if (text) {
      geminiParts.push({ text });
    }
  }

  return geminiParts;
}

/**
 * Converts a single unified message to Gemini Content format
 * Note: UnifiedMessageRole.assistant maps to Gemini's 'model' role
 * Note: UnifiedMessageRole.system maps to 'user' role (main system message is handled via systemInstruction)
 */
function convertUnifiedMessageToGeminiContent(message: Type.Entity.Message): Content {
  const parts: Part[] = [];

  // Handle tool role - returns functionResponse parts
  if (message.role === Schema.LLM.UnifiedMessageRole.tool) {
    return {
      role: 'user',
      parts: extractToolResultsFromContent(message.content)
    };
  }

  // Determine role:
  // - assistant -> 'model' (Gemini naming)
  // - system -> 'user' (Gemini doesn't support system role in contents, main one goes to systemInstruction)
  // - user -> 'user'
  let role: 'user' | 'model' = 'user';
  if (message.role === Schema.LLM.UnifiedMessageRole.assistant) {
    role = 'model';
  }

  // Add text parts
  parts.push(...convertContentPartsToGeminiTextParts(message.content));

  // For model (assistant) messages, add function calls
  if (role === 'model') {
    parts.push(...extractToolCallsFromContent(message.content));
  }

  return { role, parts };
}

/**
 * Organizes unified messages into Gemini Content format, properly grouping consecutive tool results.
 *
 * Gemini requires that after a model message with N function calls,
 * there must be exactly N function responses in a SINGLE user Content.
 *
 * Note: System messages are converted to user role since Gemini doesn't support system role
 * in contents (main system message is handled separately via systemInstruction parameter).
 */
export function organizeMessagesForGemini(messages: Type.Entity.Message[]): Content[] {
  const result: Content[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    // For tool messages, collect all consecutive tool messages into one Content
    if (message.role === Schema.LLM.UnifiedMessageRole.tool) {
      const allToolResultParts: Part[] = [];

      // Collect this and any following consecutive tool messages
      while (i < messages.length && messages[i].role === Schema.LLM.UnifiedMessageRole.tool) {
        const toolParts = extractToolResultsFromContent(messages[i].content);
        allToolResultParts.push(...toolParts);
        i++;
      }

      // Back up the index since the outer loop will increment it
      i--;

      if (allToolResultParts.length > 0) {
        result.push({
          role: 'user',
          parts: allToolResultParts
        });
      }
      continue;
    }

    // For other messages (user, assistant, system), convert normally
    // System messages are converted to user role by convertUnifiedMessageToGeminiContent
    result.push(convertUnifiedMessageToGeminiContent(message));
  }

  return result;
}
