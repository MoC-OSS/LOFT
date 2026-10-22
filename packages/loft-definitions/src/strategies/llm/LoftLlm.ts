import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodSchema } from 'zod';

import {
  ContextInterface,
  createStandardMiddlewareManager,
  Interface,
  Logger,
  Middleware,
  Strategy,
  Type
} from '../..';
import { UnifiedUsage } from './UnifiedUsage';

export interface LoftLLM<T_LLM_REQ, T_LLM_RES> {
  readonly llmName: string;
  generate(
    llmRequest: Strategy.LLM.LLMRequest<T_LLM_REQ>,
    options?: Strategy.LLM.CallOptions
  ): Promise<Strategy.LLM.LlmResponse<T_LLM_RES>>;
  /**
   * @deprecated Use chat.generate({ onEvent }) instead.
   * Removed in the next major release.
   */
  generateStream?(llmRequest: Strategy.LLM.LLMRequest<T_LLM_REQ>): Promise<Strategy.LLM.UnifiedLLMStream>;
  generateQueued(llmRequest: Strategy.LLM.LLMRequest<T_LLM_REQ>): Promise<void>;
  formatToLLMRequest: (
    correlatorIds: string[],
    computedSystemMessage: string,
    llmManifestProps: Type.LLMManifestProps['modelPreset'],
    chatHistory: Type.Entity.Message[],
    mcpTools: ListToolsResult['tools']
  ) => Promise<T_LLM_REQ>;
  formatToUnifiedLLMResponse: (
    correlatorIds: string[],
    sessionId: string,
    originalResponse: T_LLM_RES,
    llmName: string,
    manifestName: string
  ) => UnifiedLLMResponse;
  generateModelPresetSchema: () => ZodSchema<any>;
  generateResponseSchema: () => ZodSchema<any>;
  executeMiddlewareChain: (
    ctx: ContextInterface,
    response: Strategy.LLM.UnifiedLLMResponse,
    correlatorIds: string[]
  ) => Promise<Strategy.LLM.UnifiedLLMResponse>;
  getHealthCheckStatus: () => Promise<boolean>;
  /**
   * @experimental True when a middleware that may change the reply text is registered.
   * LOFT then holds back streamed text until the middleware has run.
   */
  hasOutputMiddleware?(): boolean;
  /** Stops background timers of the call manager; called by LOFT.shutdown(). */
  stop?: () => void;
  prepareGenerateRequest(
    correlatorIds: string[],
    sessionId: string,
    messages: Type.Entity.CreateMessage[],
    computedManifestMessage: string,
    modelPreset: Type.LLMManifestProps['modelPreset'],
    mpcTools?: ListToolsResult['tools'],
    priority?: number
  ): Promise<Strategy.LLM.LLMRequest<T_LLM_REQ>>;
}

export abstract class AbstractLoftLLM<T_LLM_REQ, T_LLM_RES> implements LoftLLM<T_LLM_REQ, T_LLM_RES> {
  constructor(
    protected readonly callManagerStrategy?: Strategy.CallManager,
    protected readonly loftQueue?: Strategy.LoftQueue
  ) {}
  abstract readonly llmName: string;
  protected abstract readonly log: Logger;
  protected middlewares = createStandardMiddlewareManager<ContextInterface, Strategy.LLM.UnifiedLLMResponse>(
    'llm-response'
  );
  abstract formatToLLMRequest(
    correlatorIds: string[],
    computedSystemMessage: string,
    llmManifestProps: Type.LLMManifestProps['modelPreset'],
    chatHistory: Type.Entity.Message[],
    mcpTools?: ListToolsResult['tools']
  ): Promise<T_LLM_REQ>;
  abstract formatToUnifiedLLMResponse(
    correlatorId: string[],
    sessionId: string,
    originalResponse: T_LLM_RES,
    llmName: string,
    manifestName: string
  ): UnifiedLLMResponse;
  abstract generateModelPresetSchema(): ZodSchema<any>;
  abstract generateResponseSchema(): ZodSchema<any>;

  async generate(
    llmRequest: Strategy.LLM.LLMRequest<T_LLM_REQ>,
    options?: Strategy.LLM.CallOptions
  ): Promise<Strategy.LLM.LlmResponse<T_LLM_RES>> {
    if (!this.callManagerStrategy)
      throw new Error(`If you don't provide callManagerStrategy, you should override generate method`);
    const result = await this.callManagerStrategy.call(llmRequest, options);
    return result;
  }

  useMiddleware(
    name: string,
    middleware: Middleware<ContextInterface, Strategy.LLM.UnifiedLLMResponse>,
    /** @experimental `transformsOutput: false` declares that the middleware does not change the reply text. Default true. */
    options?: { transformsOutput?: boolean }
  ) {
    this.middlewares.use(name, middleware, options);
  }

  /** @experimental */
  hasOutputMiddleware(): boolean {
    return this.middlewares.transformingCount > 0;
  }

  async executeMiddlewareChain(
    ctx: ContextInterface,
    response: Strategy.LLM.UnifiedLLMResponse,
    correlatorIds: string[]
  ): Promise<Strategy.LLM.UnifiedLLMResponse> {
    if (!this.middlewares) throw new Error('middlewares are not provided');
    const { payload } = await this.middlewares.executeChain(ctx, response, correlatorIds);
    return payload;
  }

  protected shouldIncludeMessage(message: Type.Entity.Message): boolean {
    return !message.llmIgnore;
  }

  public async prepareGenerateRequest(
    correlatorIds: string[],
    sessionId: string,
    messages: Type.Entity.Message[],
    computedSystemMessage: string,
    modelPreset: Type.LLMManifestProps['modelPreset'],
    mpcTools?: ListToolsResult['tools'],
    priority?: number
  ): Promise<Strategy.LLM.LLMRequest<T_LLM_REQ>> {
    this.log.trace(`Preparing generate request for LLM: ${this.llmName}, correlatorIds: ${correlatorIds}`);
    const filteredMessages = messages.filter((message) => this.shouldIncludeMessage(message));
    const llmRequestBody = await this.formatToLLMRequest(
      correlatorIds,
      computedSystemMessage,
      modelPreset,
      filteredMessages,
      mpcTools
    );
    const requestPayload: Strategy.LLM.LLMRequest<T_LLM_REQ> = {
      sessionId,
      requestType: Strategy.LLM.LLMRequestType.GENERATE,
      llmName: this.llmName,
      llmBody: llmRequestBody,
      priority
    };

    return requestPayload;
  }

  public async generateQueued(llmRequest: Strategy.LLM.LLMRequest<T_LLM_REQ>): Promise<void> {
    if (!this.loftQueue) throw new Error('cannot use publish method when loftQueue is not provided');
    await this.loftQueue.publish(JSON.stringify(llmRequest));
  }

  async getHealthCheckStatus(): Promise<boolean> {
    if (!this.callManagerStrategy)
      throw new Error(`If you don't provide callManagerStrategy, you should override generate method`);
    try {
      return await this.callManagerStrategy.getHealthCheckStatus();
    } catch (error) {
      return false;
    }
  }

  stop(): void {
    this.callManagerStrategy?.stop?.();
  }
}

export interface CustomLoft {
  call(path: string, content: any): Promise<unknown>;
}

// export type ToolMessageRequest = Type.Entity.CreateMessage & {
//   ctx: {
//     _system_reserved: {
//       tool: {
//         callId: string; // must be for support native LLM chained tool calls
//         native: {
//           request: unknown; // must be for support native LLM chained tool calls
//         };
//         mcp: {
//           request: Interface.MCP.CallToolRequest;
//         };
//       };
//     };
//   };
// };

// export type ToolMessageResult = Type.Entity.CreateMessage & {
//   ctx: {
//     _system_reserved: {
//       tool: {
//         callId: string; // must be for support native LLM chained tool calls
//         // native: {
//         //   result: unknown; // must be for support native LLM chained tool calls
//         // };
//         mcp: {
//           result?: Interface.MCP.CallToolReturn;
//         };
//       };
//     };
//   };
// };
export interface UnifiedLLMResponse {
  choices: Array<Interface.FacadeEntity.InteractiveOutputMessage>;
  topChoice: Interface.FacadeEntity.InteractiveOutputMessage;
  usedTools?: Array<
    Interface.FacadeEntity.InteractiveOutputMessage & {
      role: Type.LLM.UnifiedMessageRole.assistant | Type.LLM.UnifiedMessageRole.tool;
    }
  >;
  usage: UnifiedUsage; // Required: all LLM providers return usage metrics
  originalResponse: any;
}
/**
 * @deprecated Use chat.generate({ onEvent }) instead.
 * Removed in the next major release.
 */
export interface UnifiedLLMChunkResponse {
  chunk: Type.Entity.ChunkedMessage;
  originalResponse: any;
}

export interface LLMRequest<T_LLM_REQ> {
  sessionId: string;
  requestType: LLMRequestType;
  llmName: string;
  llmBody: T_LLM_REQ;
  callContext?: any;
  priority?: number;
}

export interface LlmResponse<T_LLM_RES> {
  sessionId: string;
  requestType: LLMRequestType;
  llmName: string;
  llmBody: T_LLM_RES;
  callContext?: any;
  priority?: number;
}

export enum LLMRequestType {
  GENERATE = 'GENERATE',
  GENERATE_STREAM = 'GENERATE_STREAM'
}

// export enum UnifiedMessageRole {
//   USER = 'user',
//   SYSTEM = 'system',
//   ASSISTANT = 'assistant'
// }
