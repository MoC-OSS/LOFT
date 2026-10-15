import { ContextInterface, InteractiveOutputMessage, Logger, Strategy, Type } from '@moc-global/loft-definitions';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

interface EchoRequest {
  messages: Array<{ role: string; content: string }>;
  model: string;
  max_tokens?: number;
}

interface EchoResponse {
  content: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

function extractTextContent(content: Type.Entity.FullContentPart[]): string {
  const textPart = content.find((part) => part.type === 'text');
  return textPart?.text || '';
}
export class EchoLLMStrategy extends Strategy.LLM.AbstractLoftLLM<EchoRequest, EchoResponse> {
  public readonly llmName: string;
  protected readonly log = new Logger('LLMStrategy:Echo');

  constructor(llmName: string, callManagerStrategy?: Strategy.CallManager) {
    super(callManagerStrategy);
    this.llmName = llmName;
  }

  async generate(request: Strategy.LLM.LLMRequest<EchoRequest>): Promise<Strategy.LLM.LlmResponse<EchoResponse>> {
    console.log(`🔴 EchoLLMStrategy.generate called for session: ${request.sessionId}`);
    const messages = [...request.llmBody.messages].reverse();
    const userMsg = messages.find((m) => m.role === 'user');
    const echoText = userMsg ? `echo: ${userMsg.content}` : 'echo: (no user message)';
    console.log(`🟢 EchoLLMStrategy.generate returning response for session: ${request.sessionId}`);

    return {
      sessionId: request.sessionId,
      requestType: request.requestType,
      llmName: this.llmName,
      llmBody: {
        content: echoText,
        usage: {
          input_tokens: 10,
          output_tokens: echoText.length,
          total_tokens: 10 + echoText.length
        }
      }
    };
  }

  async formatToLLMRequest(
    correlatorIds: string[],
    computedSystemMessage: string,
    modelPreset: Type.LLMManifestProps['modelPreset'],
    messages: Type.Entity.Message[],
    _mcpTools?: ListToolsResult['tools']
  ): Promise<EchoRequest> {
    const echoMessages = messages.map((m) => ({
      role: m.role,
      content: extractTextContent(m.content)
    }));

    if (computedSystemMessage) {
      echoMessages.unshift({
        role: Type.LLM.UnifiedMessageRole.system,
        content: computedSystemMessage
      });
    }

    return {
      messages: echoMessages,
      model: (modelPreset.model as string) || 'echo-model',
      max_tokens: (modelPreset.max_tokens as number) || 1000
    };
  }

  formatToUnifiedLLMResponse(
    correlatorIds: string[],
    sessionId: string,
    originalResponse: EchoResponse,
    llmName: string,
    manifestName: string
  ): Strategy.LLM.UnifiedLLMResponse {
    const topChoice = new InteractiveOutputMessage({
      id: `echo-${Date.now()}`,
      sessionId,
      content: [{ type: 'text', text: originalResponse.content }],
      role: Type.LLM.UnifiedMessageRole.assistant,
      author: 'assistant',
      llmName,
      manifestName,
      ctx: {},
      llmIgnore: false
    });

    return {
      choices: [topChoice],
      topChoice,
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        model: 'echo-mock',
        finishReason: 'stop' // TODO: Get some option from Unified finish reasons
      },
      originalResponse
    };
  }

  generateModelPresetSchema() {
    return z.object({
      model: z.string(),
      max_tokens: z.number().optional(),
      temperature: z.number().optional()
    });
  }

  generateResponseSchema() {
    return z.object({
      content: z.string(),
      usage: z.object({
        input_tokens: z.number(),
        output_tokens: z.number(),
        total_tokens: z.number()
      })
    });
  }

  async executeMiddlewareChain(
    ctx: ContextInterface,
    response: Strategy.LLM.UnifiedLLMResponse,
    _correlatorIds: string[]
  ): Promise<Strategy.LLM.UnifiedLLMResponse> {
    return response;
  }

  async generateQueued(_llmRequest: Strategy.LLM.LLMRequest<EchoRequest>): Promise<void> {
    throw new Error('Echo LLM Strategy does not support queued generation');
  }

  async prepareGenerateRequest(
    correlatorIds: string[],
    sessionId: string,
    messages: Type.Entity.Message[],
    computedSystemMessage: string,
    modelPreset: Type.LLMManifestProps['modelPreset'],
    mcpTools?: ListToolsResult['tools'],
    priority?: number
  ): Promise<Strategy.LLM.LLMRequest<EchoRequest>> {
    const filteredMessages = messages.filter((message) => !message.llmIgnore);

    const llmRequestBody = await this.formatToLLMRequest(
      correlatorIds,
      computedSystemMessage,
      modelPreset,
      filteredMessages,
      mcpTools
    );

    return {
      sessionId,
      requestType: Strategy.LLM.LLMRequestType.GENERATE,
      llmName: this.llmName,
      llmBody: llmRequestBody,
      priority
    };
  }

  getHealthCheckStatus(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
