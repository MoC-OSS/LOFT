import { Interface, Logger } from '@moc-global/loft-definitions';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { injectable } from 'inversify';

@injectable()
export class ToolInterceptorManager implements Interface.ToolInterceptorManager {
  private interceptors: Map<string, Interface.ToolInterceptor> = new Map();
  private readonly log = new Logger('ToolInterceptorManager');

  constructor() {}

  public use(mcpToolName: string, interceptor: Interface.ToolInterceptor) {
    this.log.trace(`Registering Tool Interceptor: ${mcpToolName}`);
    if (this.interceptors.has(mcpToolName)) {
      throw new Error(`A Tool Interceptor with the name "${mcpToolName}" already exists.`);
    }
    this.interceptors.set(mcpToolName, interceptor);
  }

  private getInterceptor(mcpToolName: string): Interface.ToolInterceptor | undefined {
    return this.interceptors.get(mcpToolName);
  }

  public async handle({
    ctx,
    toolRequest,
    calledTool,
    toolChain,
    executeToolFn,
    callLimits,
    toolClients,
    preventGenerate
  }: Interface.ToolInterceptorParams): Promise<CallToolResult> {
    const toolName = toolRequest.params.name;
    this.log.trace(`Handling Tool: ${toolName}`);

    const interceptor = this.getInterceptor(toolName);
    if (!interceptor) {
      this.log.trace(`No interceptor found for tool "${toolName}", executing default behavior`);
      return executeToolFn({ params: toolRequest.params });
    }

    return await interceptor({
      ctx,
      toolRequest,
      calledTool,
      toolChain,
      executeToolFn,
      callLimits,
      toolClients,
      preventGenerate
    });
  }
}
