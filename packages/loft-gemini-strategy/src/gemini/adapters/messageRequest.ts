import type { Content, Part } from '@google/genai';
import { Schema, Type } from '@moc-global/loft-definitions';

import { signUnsignedFunctionCalls, thoughtSignatureField } from './thoughtSignature';
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

// Gemini needs the MIME type of every image; the unified part may leave it out
const BASE64_SIGNATURES: Array<[prefix: string, mimeType: string]> = [
  ['iVBORw0KGgo', 'image/png'],
  ['/9j/', 'image/jpeg'],
  ['R0lGOD', 'image/gif'],
  ['UklGR', 'image/webp']
];
const URL_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif'
};
const DEFAULT_IMAGE_MIME_TYPE = 'image/jpeg';

function imageUrlMimeType(url: string): string {
  const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase();
  return (extension && URL_EXTENSIONS[extension]) || DEFAULT_IMAGE_MIME_TYPE;
}

/**
 * Converts a unified image part: base64 data goes inline, a URL goes as file data, which Gemini fetches
 */
function convertImageToGeminiPart(image: Type.Entity.ImageContent): Part {
  if (image.format === Schema.Entity.ImageFormat.BASE64) {
    const mimeType =
      image.mimeType ??
      BASE64_SIGNATURES.find(([prefix]) => image.data.startsWith(prefix))?.[1] ??
      DEFAULT_IMAGE_MIME_TYPE;
    return { inlineData: { mimeType, data: image.data } };
  }
  return { fileData: { fileUri: image.url, mimeType: imageUrlMimeType(image.url) } };
}

/**
 * Converts unified content parts to Gemini parts: text and images
 */
function convertContentPartsToGeminiParts(parts: Type.Entity.FullContentPart[]): Part[] {
  const geminiParts: Part[] = [];

  for (const part of parts) {
    if (part.type === 'tool_call' || part.type === 'tool_result') {
      continue;
    }

    if (part.type === 'image') {
      geminiParts.push(convertImageToGeminiPart(part));
      continue;
    }

    const text = extractTextFromContentPart(part);
    if (text) {
      geminiParts.push({ text, ...(part.type === 'text' ? thoughtSignatureField(part) : {}) });
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

  // Add text and image parts
  parts.push(...convertContentPartsToGeminiParts(message.content));

  // For model (assistant) messages, add function calls
  if (role === 'model') {
    parts.push(...extractToolCallsFromContent(message.content));
    signUnsignedFunctionCalls(parts);
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
