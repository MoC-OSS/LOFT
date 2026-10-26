import { InteractiveOutputMessage, Logger, Strategy, Type } from '@moc-global/loft-definitions';
import {
  ChatCompletion,
  ChatCompletionMessage,
  ChatCompletionMessageToolCall
} from 'openai/resources/chat/completions';

const log = new Logger('OpenAIStrategy');

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

  // Add tool calls if they exist. Newer openai versions add custom tool calls, which LOFT cannot run; it declares only
  // function tools, so a custom call means the request was changed outside LOFT. It is skipped, and the response fails
  // only when nothing else is left in it
  const toolCalls = message.tool_calls ?? [];
  for (const toolCall of toolCalls) {
    if (toolCall.type === 'function') {
      parts.push(toolCallToContentPart(toolCall));
    } else {
      log.warn(`Skipped an OpenAI tool call of type "${toolCall.type}"; LOFT supports only function tool calls`);
    }
  }
  if (parts.length === 0 && toolCalls.length > 0) {
    throw new Error(
      'OpenAI returned only tool calls of a type other than function; LOFT supports only function tool calls'
    );
  }

  // audio content - will be designed in future because mimeType is available in request and not provided in response

  // function_call - is deprecated

  // annotations - will be designed in future

  return parts;
}

/**
 * Converts an OpenAI ChatCompletionMessageToolCall to a Unified tool_call ContentPart
 */
function toolCallToContentPart(
  toolCall: Extract<ChatCompletionMessageToolCall, { type: 'function' }>
): Type.Entity.FullContentPart {
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

/**
 * Reads the reasoning tokens of a completion. OpenAI reports them under `completion_tokens_details`.
 */
export function openAiReasoningTokens(usage: ChatCompletion['usage']): number | undefined {
  return usage?.completion_tokens_details?.reasoning_tokens;
}

/**
 * Maps the usage of a completion to the unified usage (always provide values, use 0 if missing)
 */
export function openAiUsageToUnified(
  usage: ChatCompletion['usage'],
  model: string,
  finishReason: string | undefined
): Strategy.LLM.StreamUsage {
  return {
    inputTokens: usage?.prompt_tokens || 0,
    outputTokens: usage?.completion_tokens || 0,
    totalTokens: usage?.total_tokens || 0,
    reasoningTokens: openAiReasoningTokens(usage),
    model,
    finishReason
  };
}
