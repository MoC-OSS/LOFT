import { randomUUID } from 'node:crypto';

import { Logger, Schema, Type } from '@moc-global/loft-definitions';
import {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam
} from 'openai/resources/chat/completions';

const log = new Logger('OpenAIStrategy');

// Converts a single ContentPart to an OpenAI ChatCompletionContentPart
function contentPartToOpenAi(part: Type.Entity.FullContentPart): ChatCompletionContentPart | null {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text };
    case 'image': {
      // Handle both base64 and url formats for images
      let url: string;
      let detail: 'auto' | 'low' | 'high' | undefined;
      if (part.format === Schema.Entity.ImageFormat.BASE64) {
        // If mimeType is provided, use it, otherwise default to image/png
        const mime = part.mimeType || 'image/png';
        url = `data:${mime};base64,${part.data}`;
        detail = part.detail;
      } else {
        url = part.url;
        detail = part.detail;
      }
      return {
        type: 'image_url',
        image_url: {
          url,
          detail
        }
      };
    }
    case 'audio':
      return {
        type: 'input_audio',
        input_audio: {
          data: part.data,
          // Only 'wav' and 'mp3' are supported by OpenAI
          format: part.mimeType === 'audio/wav' ? 'wav' : 'mp3'
        }
      };
    case 'resource':
      // For resources, try to map to file or text if possible
      if ('text' in part.resource && typeof part.resource.text === 'string') {
        // Text resource as text
        return { type: 'text', text: part.resource.text };
      } else if (
        'blob' in part.resource &&
        typeof part.resource.blob === 'string' &&
        typeof part.resource.uri === 'string'
      ) {
        // Blob resource as file
        return {
          type: 'file',
          file: {
            file_data: part.resource.blob,
            filename: part.resource.uri
          }
        }; //as any; // OpenAI types may require file_id for uploaded files
      }
      throw new Error('Unknown resource content');
    default:
      log.warn(`Unsupported ContentPart type: ${(part as any).type}`);
      return null;
  }
}

// Converts an array of ContentPart to OpenAI ChatCompletionUserMessageContent
export function contentPartsToOpenAiMessageContent(
  parts: Type.Entity.FullContentPart[]
): ChatCompletionUserMessageParam['content'] {
  return parts.map(contentPartToOpenAi).filter((part): part is ChatCompletionContentPart => part !== null);
}

// Extract tool calls from unified content parts
function extractToolCalls(parts: Type.Entity.FullContentPart[]): ChatCompletionMessageToolCall[] {
  return parts
    .filter((part) => part.type === 'tool_call')
    .map((part) => ({
      id: part.callId || `call_${randomUUID()}`,
      type: 'function',
      function: {
        name: part.params?.name || 'unknown',
        arguments: JSON.stringify(part.params?.arguments || {})
      }
    }));
}

// OpenAI takes one tool message per tool call. An unmatched tool call is rejected by the API,
// so a result without text is sent as empty text instead of being dropped.
function toolResultsToOpenAiMessages(message: Type.Entity.Message): ChatCompletionToolMessageParam[] {
  return message.content
    .filter((part) => part.type === 'tool_result')
    .flatMap((toolResult): ChatCompletionToolMessageParam[] => {
      if (!toolResult.callId) {
        log.error(
          `Missing tool call ID for message ${message.id} (role: ${message.role}, session: ${message.sessionId})`
        );
        return [];
      }
      const toolContent = toolResult.content.filter((p) => p.type === 'text');
      return [{ role: 'tool', content: toolContent.length > 0 ? toolContent : '', tool_call_id: toolResult.callId }];
    });
}

// Converts an array of UnifiedMessages to OpenAI ChatCompletionUserMessage
export function unifiedMessagesToOpenAiMessages(messages: Type.Entity.Message[]): ChatCompletionMessageParam[] {
  return messages
    .flatMap((message): ChatCompletionMessageParam | ChatCompletionMessageParam[] | null => {
      // Extract only text parts directly from the message content
      const textParts = message.content.filter((part) => part.type === 'text');

      switch (message.role) {
        case Schema.LLM.UnifiedMessageRole.user:
          return {
            role: 'user',
            content: contentPartsToOpenAiMessageContent(message.content),
            name: message.author
          };
        case Schema.LLM.UnifiedMessageRole.assistant: {
          const toolCalls = extractToolCalls(message.content);

          return {
            role: 'assistant',
            content: textParts,
            name: message.author,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined
          };
        }
        case Schema.LLM.UnifiedMessageRole.system:
          return {
            role: 'system',
            content: textParts,
            name: message.author
          };
        // deprecated -- use tools instead function
        // case Schema.LLM.UnifiedMessageRole.function:
        //   return {
        //     role: 'function',
        //     content: textParts.map((p) => p.text).join('\n'),
        //     name: message.author || 'function',
        //     tool_call_id: message.content.find((p) => p.type === 'tool_call')?.callId || ''
        //   };
        case Schema.LLM.UnifiedMessageRole.tool:
          return toolResultsToOpenAiMessages(message);
        default:
          log.error(`Unsupported role: ${message.role}, messageId: ${message.id}, sessionId: ${message.sessionId}`);
          return null;
      }
    })
    .filter((msg): msg is ChatCompletionMessageParam => msg !== null);
}
