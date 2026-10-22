import Anthropic from '@anthropic-ai/sdk';
import { ContextInterface, Interface, Logger, Middleware, Strategy, Type } from '@moc-global/loft-definitions';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodSchema } from 'zod';

import { convertUnifiedMessagesToAnthropicMessages } from './adapters/messageRequest';
import { formatAnthropicResponseToUnified } from './adapters/messageResponse';
import { ThinkingCache } from './adapters/thinking';
import { convertMcpToolToAnthropicTool } from './adapters/toolDeclaration';
import { AnthropicStream } from './AnthropicStream';
import { AnthropicRequest, AnthropicResponse } from './AnthropicTypes';
import { MessageCreateParamsSchema } from './AnthropicValidatingSchemas';

// Create an interface that replicates just the methods we need to implement
// without directly using the generic parameters that cause circular references
interface LoftLLMImplementation {
  readonly llmName: string;
  formatToLLMRequest(
    correlatorIds: string[],
    computedSystemMessage: string,
    modelPreset: Type.LLMManifestProps['modelPreset'],
    messages: Type.Entity.Message[],
    mcpTools?: ListToolsResult['tools']
  ): Promise<AnthropicRequest>;
  formatToUnifiedLLMResponse(
    correlatorIds: string[],
    sessionId: string,
    originalResponse: AnthropicResponse,
    llmName: string,
    manifestName: string
  ): Strategy.LLM.UnifiedLLMResponse;
  /**
   * @deprecated Use chat.generate({ onEvent }) instead.
   * Removed in the next major release.
   */
  generateStream(llmRequest: Strategy.LLM.LLMRequest<AnthropicRequest>): Promise<Strategy.LLM.UnifiedLLMStream>;
  generateModelPresetSchema(): ZodSchema<any>;
  generateResponseSchema(): ZodSchema<any>;
}

/**
 * A Focus turn may run without a message from the user: the Focus prompt, which goes into `system`, opens the
 * conversation or asks the next question after the assistant's own answer. Claude needs at least one message, and
 * current Claude models need a conversation that ends with the user, so a short user turn is added to the request. It
 * is not saved to the chat history. "Continue." is added only with a Focus prompt, so a request that ends with an
 * assistant message on purpose (prefill, on models that support it) is sent as it is.
 */
function addOpeningUserTurn(messages: Anthropic.MessageParam[], hasFocusPrompt: boolean): void {
  if (messages.length === 0) {
    messages.push({ role: 'user', content: [{ type: 'text', text: 'Start.' }] });
  } else if (hasFocusPrompt && messages[messages.length - 1].role === 'assistant') {
    messages.push({ role: 'user', content: [{ type: 'text', text: 'Continue.' }] });
  }
}

// Create a class that doesn't directly extend the problematic generic class
export class AnthropicLoftStrategy implements LoftLLMImplementation {
  public readonly llmName: string;
  private baseStrategy: any;
  private readonly log = new Logger('LLMStrategy:Anthropic');
  private readonly thinking = new ThinkingCache();

  constructor({ llmName, loftQueue }: Interface.StrategyArgsFacade, callManagerStrategy: Strategy.CallManager) {
    // Use composition instead of inheritance
    this.baseStrategy = new (Strategy.LLM.AbstractLoftLLM as any)(callManagerStrategy, loftQueue);
    this.llmName = llmName;
  }

  async formatToLLMRequest(
    correlatorIds: string[],
    computedSystemMessage: string,
    modelPreset: Type.LLMManifestProps['modelPreset'],
    messages: Type.Entity.Message[],
    mcpTools: ListToolsResult['tools'] = []
  ): Promise<AnthropicRequest> {
    // Convert unified messages to Anthropic format
    const anthropicMessages = convertUnifiedMessagesToAnthropicMessages(messages, (message) =>
      this.thinking.forMessage(message.content)
    );
    addOpeningUserTurn(
      anthropicMessages,
      messages.some((message) => isSystemMessage(message) && message.author === 'focus')
    );

    // Anthropic takes one system prompt and no system messages in the conversation. The conversation's system
    // messages (Focus instructions, context from earlier agents, notices from LOFT) are appended to it in order,
    // because the message conversion leaves them out.
    const system = [computedSystemMessage, ...messages.filter(isSystemMessage).map(textOf)]
      .filter((text) => text.length > 0)
      .join('\n\n');

    // Convert MCP tools to Anthropic tools format
    const anthropicTools = convertMcpToolToAnthropicTool(mcpTools);

    const llmBody = {
      ...modelPreset,
      system,
      messages: anthropicMessages,
      // Default max_tokens if not specified
      max_tokens: typeof modelPreset.max_tokens === 'number' ? modelPreset.max_tokens : 4096,
      model: modelPreset.model as Anthropic.Model,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined
    };

    return llmBody;
  }

  formatToUnifiedLLMResponse(
    correlatorIds: string[],
    sessionId: string,
    originalResponse: AnthropicResponse,
    llmName: string,
    manifestName: string
  ): Strategy.LLM.UnifiedLLMResponse {
    this.thinking.keep(originalResponse.content);

    // Format the Anthropic response to unified format using the adapter
    return formatAnthropicResponseToUnified(
      originalResponse.content,
      { correlatorIds, sessionId, llmName, manifestName },
      originalResponse
    );
  }

  /**
   * @deprecated Use chat.generate({ onEvent }) instead.
   * Removed in the next major release.
   */
  async generateStream(llmRequest: Strategy.LLM.LLMRequest<AnthropicRequest>): Promise<Strategy.LLM.UnifiedLLMStream> {
    if (!this.baseStrategy.callManagerStrategy)
      throw new Error('Cannot use streamCall method when callManagerStrategy is not provided');
    const res = await this.baseStrategy.callManagerStrategy.streamCall(llmRequest);
    const anthropicStream = new AnthropicStream();
    res.pipe(anthropicStream);

    return anthropicStream;
  }

  generateModelPresetSchema(): ZodSchema<any> {
    return MessageCreateParamsSchema;
  }

  generateResponseSchema(): ZodSchema<any> {
    throw new Error('Method generateResponseSchema() not implemented in Anthropic LLM Strategy.');
  }

  // Delegate methods to baseStrategy as needed
  async generate(llmRequest: any, options?: Strategy.LLM.CallOptions): Promise<any> {
    return this.baseStrategy.generate(llmRequest, options);
  }

  async generateQueued(llmRequest: any): Promise<void> {
    return this.baseStrategy.generateQueued(llmRequest);
  }

  async prepareGenerateRequest(
    correlatorIds: string[],
    sessionId: string,
    messages: Type.Entity.Message[],
    computedSystemMessage: string,
    modelPreset: Type.LLMManifestProps['modelPreset'],
    mpcTools?: ListToolsResult['tools'],
    priority?: number
  ): Promise<any> {
    // Custom implementation that doesn't use the problematic generic base class method
    const filteredMessages = messages.filter((message) => !message.llmIgnore);
    const llmRequestBody = await this.formatToLLMRequest(
      correlatorIds,
      computedSystemMessage,
      modelPreset,
      filteredMessages,
      mpcTools
    );
    const requestPayload = {
      sessionId,
      requestType: Strategy.LLM.LLMRequestType.GENERATE,
      llmName: this.llmName,
      llmBody: llmRequestBody,
      priority
    };

    return requestPayload;
  }

  async executeMiddlewareChain(ctx: ContextInterface, response: any, correlatorIds: string[]): Promise<any> {
    return this.baseStrategy.executeMiddlewareChain(ctx, response, correlatorIds);
  }

  async getHealthCheckStatus(): Promise<boolean> {
    return this.baseStrategy.getHealthCheckStatus();
  }

  stop(): void {
    this.baseStrategy.stop();
  }

  useMiddleware(
    name: string,
    middleware: Middleware<ContextInterface, Strategy.LLM.UnifiedLLMResponse>,
    /** @experimental `transformsOutput: false` declares that the middleware does not change the reply text. Default true. */
    options?: { transformsOutput?: boolean }
  ): void {
    this.baseStrategy.useMiddleware(name, middleware, options);
  }

  /** @experimental True when a middleware that may change the reply text is registered. */
  hasOutputMiddleware(): boolean {
    return this.baseStrategy.hasOutputMiddleware();
  }
}

function isSystemMessage(message: Type.Entity.Message): boolean {
  return message.role === Type.LLM.UnifiedMessageRole.system;
}

function textOf(message: Type.Entity.Message): string {
  return message.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
    .trim();
}
