import type { Content, Part } from '@google/genai';
import { Logger, Schema, Type } from '@moc-global/loft-definitions';

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

const log = new Logger('GeminiMessageRequest');

const URL_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  bmp: 'image/bmp'
};
// The brands of an ISO media file (bytes 8-11, after "ftyp") that are images
const FTYP_BRANDS: Record<string, string> = {
  avif: 'image/avif',
  avis: 'image/avif',
  heic: 'image/heic',
  heix: 'image/heic',
  mif1: 'image/heif',
  msf1: 'image/heif'
};
const DEFAULT_IMAGE_MIME_TYPE = 'image/jpeg';
// Gemini fetches only these; anything else (http:, file:, a relative path) would fail every later request
const FETCHABLE_URL = /^(?:https|gs):\/\//i;
const DATA_URL = /^data:([^;,]+)?(;base64)?,(.*)$/is;

// Gemini needs the MIME type of every image; the unified part may leave it out, so read it from the first bytes
function base64MimeType(data: string): string | undefined {
  const bytes = Buffer.from(data.slice(0, 24), 'base64');
  const ascii = (start: number, end: number) => bytes.subarray(start, end).toString('latin1');
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp') return FTYP_BRANDS[ascii(8, 12)];
  if (ascii(0, 2) === 'BM') return 'image/bmp';
  return undefined;
}

function imageUrlMimeType(url: string): string | undefined {
  const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase();
  return extension ? URL_EXTENSIONS[extension] : undefined;
}

function inlineImage(data: string, mimeType: string | undefined): Part {
  const detected = mimeType ?? base64MimeType(data);
  if (!detected) log.warn(`Unknown image type, sent as ${DEFAULT_IMAGE_MIME_TYPE}`);
  return { inlineData: { mimeType: detected ?? DEFAULT_IMAGE_MIME_TYPE, data } };
}

/**
 * Converts a unified image part: base64 data (and a base64 `data:` URL) goes inline, an `https:` or `gs:` URL goes
 * as file data, which Gemini fetches. Any other URL is left out with a warning: Gemini would reject the request,
 * and as the history is sent again on every turn, every later request of the session too.
 */
function convertImageToGeminiPart(image: Type.Entity.ImageContent): Part | null {
  if (image.format === Schema.Entity.ImageFormat.BASE64) {
    return inlineImage(image.data, image.mimeType);
  }
  // The URL schema takes extra keys, so a mimeType given on the part is used too
  const partMimeType = typeof image.mimeType === 'string' ? image.mimeType : undefined;
  const dataUrl = DATA_URL.exec(image.url);
  if (dataUrl) {
    if (dataUrl[2]) return inlineImage(dataUrl[3], partMimeType ?? dataUrl[1]);
    log.warn('Left out an image data: URL that is not base64');
    return null;
  }
  if (!FETCHABLE_URL.test(image.url)) {
    log.warn(`Left out an image URL Gemini cannot fetch: ${image.url.slice(0, 100)}`);
    return null;
  }
  const mimeType = partMimeType ?? imageUrlMimeType(image.url);
  if (!mimeType) log.warn(`Unknown image type of ${image.url.slice(0, 100)}, sent as ${DEFAULT_IMAGE_MIME_TYPE}`);
  return { fileData: { fileUri: image.url, mimeType: mimeType ?? DEFAULT_IMAGE_MIME_TYPE } };
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
      const imagePart = convertImageToGeminiPart(part);
      if (imagePart) geminiParts.push(imagePart);
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

type ToolCallPart = Type.Entity.FullContentPart & { type: 'tool_call' };

// Records the message's tool calls by callId; a later call with the same id replaces an earlier one
function rememberToolCalls(message: Type.Entity.Message, toolCalls: Map<string, ToolCallPart>): void {
  for (const part of message.content) {
    if (part.type === 'tool_call' && part.callId) toolCalls.set(part.callId, part);
  }
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
  // The tool calls made so far by callId; a later call with the same id replaces an earlier one, so a tool result
  // answers the latest call before it
  const toolCalls = new Map<string, ToolCallPart>();

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    // For tool messages, collect all consecutive tool messages into one Content
    if (message.role === Schema.LLM.UnifiedMessageRole.tool) {
      const allToolResultParts: Part[] = [];

      // Collect this and any following consecutive tool messages
      while (i < messages.length && messages[i].role === Schema.LLM.UnifiedMessageRole.tool) {
        const toolParts = extractToolResultsFromContent(messages[i].content, toolCalls);
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
    rememberToolCalls(message, toolCalls);
    const content = convertUnifiedMessageToGeminiContent(message);
    // Gemini rejects a content without parts, such as a message whose only image was left out
    if (content.parts?.length) result.push(content);
  }

  return result;
}
