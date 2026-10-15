import Anthropic from '@anthropic-ai/sdk';
import { Logger, Schema, Type } from '@moc-global/loft-definitions';

import { extractToolCallsFromContent } from './toolRequest';

const log = new Logger('AnthropicStrategy');

type ContentType = 'text' | 'image' | 'tool_call' | 'tool_result';

/**
 * Extracts text content from a unified content part
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
    case 'tool_result':
      if (part.content && Array.isArray(part.content)) {
        return part.content
          .filter((item) => item.type === 'text')
          .map((item) => (item.type === 'text' ? item.text : ''))
          .join('\n');
      }
      return null;
    default:
      return null;
  }
}

/**
 * Converts a unified image part to an Anthropic image block
 */
function convertUnifiedImageToAnthropicImage(imagePart: Type.Entity.ImageContent): Anthropic.ImageBlockParam | null {
  if (imagePart.format === Schema.Entity.ImageFormat.BASE64) {
    // Anthropic only supports specific MIME types
    let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    if (!imagePart.mimeType || !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(imagePart.mimeType)) {
      mediaType = 'image/jpeg'; // Default if missing or unsupported
    } else {
      mediaType = imagePart.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    }

    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: imagePart.data
      } as Anthropic.Base64ImageSource
    };
  }

  if (imagePart.format === Schema.Entity.ImageFormat.URL) {
    return {
      type: 'image',
      source: {
        type: 'url',
        url: imagePart.url
      } as Anthropic.URLImageSource
    };
  }

  // For unsupported formats, log warning and return null
  log.warn(`Unsupported image format encountered: ${(imagePart as any).format || 'unknown'}`);
  return null;
}

/**
 * Converts unified content parts to Anthropic content blocks for the request
 */
function convertContentPartsToAnthropicBlocks(parts: Type.Entity.FullContentPart[]): Anthropic.ContentBlockParam[] {
  const contentBlocks: Anthropic.ContentBlockParam[] = [];
  const textFragments: string[] = [];

  // Group parts by type
  const contentByType = parts.reduce(
    (acc, part) => {
      const type = part.type as ContentType;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(part);
      return acc;
    },
    {} as Record<ContentType, Type.Entity.FullContentPart[]>
  );

  // Process images first
  if (contentByType['image']) {
    contentByType['image'].forEach((part) => {
      try {
        // Explicitly cast image parts to the correct type
        const imagePart = part as Type.Entity.FullContentPart & { type: 'image' };
        const anthropicImage = convertUnifiedImageToAnthropicImage(imagePart);
        if (anthropicImage) contentBlocks.push(anthropicImage);
      } catch (error) {
        log.warn('Failed to convert image part to Anthropic format:', error);
      }
    });
  }

  // Collect text from normal text parts and other convertible parts
  parts.forEach((part) => {
    if (part.type !== 'image' && part.type !== 'tool_call') {
      const text = extractTextFromContentPart(part);
      if (text) {
        textFragments.push(text);
      }
    }
  });

  // Add combined text as a single block
  if (textFragments.length > 0) {
    contentBlocks.push({
      type: 'text',
      text: textFragments.join(' ')
    });
  }

  return contentBlocks;
}

/**
 * Convert tool result content to Anthropic tool_result format
 */
function convertUnifiedToolResultToAnthropicToolResult(
  toolResult: Type.Entity.FullContentPart & { type: 'tool_result' }
): Anthropic.ToolResultBlockParam {
  // Explicitly type the array to only contain Text or Image blocks
  const contentBlocks: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = [];

  if (toolResult.content && Array.isArray(toolResult.content)) {
    for (const item of toolResult.content) {
      if (item.type === 'text') {
        contentBlocks.push({ type: 'text', text: item.text });
      } else if (item.type === 'image') {
        const imagePart = item as Type.Entity.ImageContent;
        const anthropicImage = convertUnifiedImageToAnthropicImage(imagePart);
        if (anthropicImage) {
          contentBlocks.push(anthropicImage);
        } else {
          log.warn(
            `Failed to convert image within tool result (callId: ${toolResult.callId || 'unknown'}) to Anthropic format.`
          );
        }
      } else {
        log.warn(
          `Unsupported content type ${item.type} within tool result (callId: ${toolResult.callId || 'unknown'}).`
        );
      }
      // Ignore other content types like audio or resource
    }
  }

  // Always return the content as an array of blocks, even if only text is present.
  // Anthropic's type for tool_result.content accepts this array format.
  return {
    type: 'tool_result',
    tool_use_id: toolResult.callId || 'missing-call-id-this-should-never-happen',
    content: contentBlocks, // Always return the array of blocks
    // Tells the model the content is the tool's error message, not its output
    ...(toolResult.isError ? { is_error: true } : {})
  };
}

/**
 * Extract tool results from unified content parts
 */
function extractToolResultsFromContent(parts: Type.Entity.FullContentPart[]): Anthropic.ToolResultBlockParam[] {
  return parts
    .filter((part): part is Type.Entity.FullContentPart & { type: 'tool_result' } => part.type === 'tool_result')
    .map(convertUnifiedToolResultToAnthropicToolResult);
}

/**
 * Converts a unified message to an Anthropic message format for requests
 */
export function convertUnifiedMessageToAnthropicMessage(message: Type.Entity.Message): Anthropic.MessageParam {
  // Determine the role (Anthropic only supports user and assistant)
  let role: 'user' | 'assistant';
  switch (message.role) {
    case Schema.LLM.UnifiedMessageRole.user:
      role = 'user';
      break;
    case Schema.LLM.UnifiedMessageRole.assistant:
      role = 'assistant';
      break;
    case Schema.LLM.UnifiedMessageRole.system:
      log.warn('System messages should use the system parameter, not as a message');
      role = 'user'; // Fallback to user
      break;
    case Schema.LLM.UnifiedMessageRole.tool:
      // Tool results are converted to a user message with tool_result blocks
      return {
        role: 'user',
        content: extractToolResultsFromContent(message.content)
      };
    default:
      log.warn(`Unsupported role ${message.role}, defaulting to 'user'`);
      role = 'user';
  }

  // Convert content parts to Anthropic blocks
  const contentBlocks = convertContentPartsToAnthropicBlocks(message.content);

  // For assistant messages, add tool calls
  if (role === 'assistant') {
    const toolCalls = extractToolCallsFromContent(message.content);
    if (toolCalls.length > 0) {
      contentBlocks.push(...toolCalls);
    }
  }

  // Anthropic rejects assistant messages whose final content ends with trailing whitespace.
  // Trim text blocks on assistant messages to prevent 400 errors.
  if (role === 'assistant') {
    for (const block of contentBlocks) {
      if (block.type === 'text') {
        block.text = block.text.trimEnd();
      }
    }
  }

  return {
    role,
    content: contentBlocks
  };
}

/**
 * Properly organize tool calls and results to follow Anthropic's API requirements
 * Each tool_use must be followed by a user message containing the tool_result
 */
function organizeMessagesForAnthropic(messages: Type.Entity.Message[]): Anthropic.MessageParam[] {
  return messages.reduce((acc, currentMessage, index, arr) => {
    // Skip system messages as they're handled separately
    if (currentMessage.role === Schema.LLM.UnifiedMessageRole.system) {
      return acc;
    }

    // Skip tool messages directly; they are handled when processing the preceding assistant message
    if (currentMessage.role === Schema.LLM.UnifiedMessageRole.tool) {
      return acc;
    }

    // Convert the current message (user or assistant)
    // This handles adding tool_calls to assistant messages internally
    const anthropicMessage = convertUnifiedMessageToAnthropicMessage(currentMessage);
    acc.push(anthropicMessage);

    // Anthropic requires the results of every tool call in the assistant message to follow it in one user message.
    // Parallel tool calls produce one tool message per result, so collect all consecutive tool messages.
    if (currentMessage.role === Schema.LLM.UnifiedMessageRole.assistant) {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (let next = index + 1; next < arr.length && arr[next].role === Schema.LLM.UnifiedMessageRole.tool; next++) {
        toolResults.push(...extractToolResultsFromContent(arr[next].content));
      }
      if (toolResults.length > 0) {
        acc.push({ role: 'user', content: toolResults });
      }
    }

    return acc;
  }, [] as Anthropic.MessageParam[]);
}

/**
 * Converts an array of unified messages to Anthropic message format
 * Filters out system messages as they're handled differently
 */
export function convertUnifiedMessagesToAnthropicMessages(messages: Type.Entity.Message[]): Anthropic.MessageParam[] {
  return organizeMessagesForAnthropic(messages);
}
