import { Container } from 'inversify';

import { Interface } from '..';
import {
  BeforeGenerateMiddleware,
  Chat,
  ContextInterface,
  GenerateRequestParameters,
  StandardMiddleware
} from '../shared';
import type { MCPClientMetadata } from './mcp/types';

export interface ChatConstructor<T = any> extends Interface.ExternalComponentConstructor<T> {
  getInstance(): T;
  initializeContainer(mainContainer: Container): void;
  registerInputMiddleware(
    name: string,
    middleware: StandardMiddleware<ContextInterface, GenerateRequestParameters>
  ): void;
  registerBeforeGenerateMiddleware(
    name: string,
    middleware: BeforeGenerateMiddleware<ContextInterface, GenerateRequestParameters>
  ): void;
  registerAfterGenerateMiddleware(
    name: string,
    middleware: StandardMiddleware<ContextInterface, Chat.GenerateResultMessages>,
    /** @experimental `transformsOutput: false` declares that the middleware does not change the reply text. Default true. */
    options?: { transformsOutput?: boolean }
  ): void;
  // registerLlmStrategy<T_LLM_Req, T_LLM_Res>(
  //   llmName: string,
  //   llmStrategy: Strategy.LLM.LoftLLM<T_LLM_Req, T_LLM_Res>
  // ): void;
  // registerGMComputer(manifestName: string, llmName: string, handler: Interface.PromptComputer<ContextInterface>): void;
  // registerATMComputer(manifestName: string, llmName: string, handler: Interface.PromptComputer<ContextInterface>): void;
  // registerPromptComputer(
  //   manifestName: string,
  //   llmName: string,
  //   handler: Interface.PromptComputer<ContextInterface>
  // ): void;
  // validateManifest(): void;
  useMcpClient(mcpName: string, mcpClient: Interface.MCP.Client, metadata?: Partial<MCPClientMetadata>): Promise<void>;
  registerToolInterceptor(mcpToolName: string, interceptor: Interface.ToolInterceptor): void;
}

/** @experimental Part of the Queued execution mode, which is not implemented yet. May change or be removed in any release. */
export interface ChatConstructorWithSMG<T = any> extends Omit<ChatConstructor<T>, 'registerInputMiddleware'> {
  registerInputMiddleware(name: string, middleware: StandardMiddleware<ContextInterface, Chat.ChatInputPayload>): void;
}
