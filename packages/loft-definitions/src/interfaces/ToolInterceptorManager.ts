import type { CallToolRequest, CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

import { Type } from '..';
import { Interface } from '..';
import { ContextInterface } from '../shared/components/middleware';
import { OverrideGeneratePayload } from '../shared/components/middleware/chain/ChainInterfaces';

export interface ToolInterceptorParams {
  ctx: ContextInterface;
  toolRequest: Type.Entity.ToolCallContent;
  calledTool: Tool;
  toolChain: Interface.FacadeEntity.InteractiveOutputMessage[];
  executeToolFn: (options: { params: CallToolRequest['params']; clientNames?: string[] }) => Promise<CallToolResult>;
  callLimits: { current: number; max: number };
  toolClients: Array<{ clientName: string; metadata: Record<string, any> }>;
  preventGenerate: (overrideGeneratePayload: OverrideGeneratePayload) => void;
}

export type ToolInterceptor = (params: ToolInterceptorParams) => Promise<CallToolResult>;

export interface ToolInterceptorManager {
  use(mcpToolName: string, interceptor: ToolInterceptor): void;
  handle(params: ToolInterceptorParams): Promise<CallToolResult>;
}
