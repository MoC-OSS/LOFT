import { InteractiveOutputMessage, Type } from '@moc-global/loft-definitions';
import {
  ChatCompletion,
  ChatCompletionMessage,
  ChatCompletionMessageToolCall
} from 'openai/resources/chat/completions';

/**
 * Converts OpenAI ChatCompletionMessage to Unified ContentParts
 */
function openAiMessageToContentParts(message: ChatCompletionMessage): Type.Entity.FullContentPart[] {
  const parts: Type.Entity.FullContentPart[] = [];

  // Add text content if it exists
  if (message.content) {
    parts.push({
      type: 'text',
      text: message.content
    } as Type.Entity.FullContentPart);
  }

  // Add refusal content if it exists
  if (message.refusal) {
    parts.push({
      type: 'text',
      text: message.refusal
    } as Type.Entity.FullContentPart);
  }

  // Add tool calls if they exist
  if (message.tool_calls && message.tool_calls.length > 0) {
    for (const toolCall of message.tool_calls) {
      parts.push(toolCallToContentPart(toolCall));
    }
  }

  // audio content - will be designed in future because mimeType is available in request and not provided in response

  // function_call - is deprecated

  // annotations - will be designed in future

  return parts;
}

/**
 * Converts an OpenAI ChatCompletionMessageToolCall to a Unified tool_call ContentPart
 */
function toolCallToContentPart(toolCall: ChatCompletionMessageToolCall): Type.Entity.FullContentPart {
  // Newer openai versions add custom tool calls, which LOFT cannot run; it declares only function tools, so a custom
  // call means the request was changed outside LOFT
  if (toolCall.type !== 'function') {
    throw new Error(
      `OpenAI returned a tool call of type "${(toolCall as { type: string }).type}"; LOFT supports only function tool calls`
    );
  }

  return {
    type: 'tool_call',
    method: 'tools/call' as const,
    callId: toolCall.id,
    params: {
      name: toolCall.function.name,
      arguments: JSON.parse(toolCall.function.arguments)
    }
  } as Type.Entity.FullContentPart;
}

/**
 * Options for OpenAI to Unified converters
 */
export interface OpenAiToUnifiedOptions {
  correlatorIds: string[];
  sessionId: string;
  manifestName: string;
  llmName: string;
}

/**
 * Converts an OpenAI ChatCompletion to a Unified Message
 */
export function openAiChoiceToUnifiedMessage(
  choice: ChatCompletion.Choice,
  options: OpenAiToUnifiedOptions
): InteractiveOutputMessage {
  const { sessionId, llmName, manifestName } = options;

  const message = choice.message;

  return new InteractiveOutputMessage({
    sessionId,
    ctx: {},
    content: openAiMessageToContentParts(message),
    role: Type.LLM.UnifiedMessageRole[message.role], // assistant
    author: message.role,
    llmName,
    manifestName,
    llmIgnore: false
  });
}
