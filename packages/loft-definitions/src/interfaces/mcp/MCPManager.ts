import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { CallToolRequest, CallToolResult, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { CallToolResultSchema, CompatibilityCallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

import type { MCPClientMetadata } from './types';

export interface MCPManager {
  /**
   * Register a new MCP client
   * @param mcpName - Name of the MCP client
   * @param mcpClient - Client instance to register
   * @param metadata - Optional metadata to associate with the client (LOFT auto-adds transportType, registeredAt, toolCount)
   */
  useClient(mcpName: string, mcpClient: Client, metadata?: Partial<MCPClientMetadata>): Promise<void>;

  /**
   * Get lists of tools from all registered MCP clients
   */
  listsOfTools(): Promise<ListToolsResult[]>;

  /**
   * Get a flat list of all tools from all registered MCP clients
   */
  listTools(): Promise<ListToolsResult['tools']>;

  /**
   * Call a tool across all registered MCP clients and aggregate results
   * @param params - Parameters for the tool call
   * @param resultSchema - Optional schema for the result
   * @param requestOptions - Optional request options
   * @param clientNames - Optional array of client names to execute on. If empty or not provided, executes on all supporting clients
   */
  callTool(
    params: CallToolRequest['params'],
    resultSchema?: typeof CallToolResultSchema | typeof CompatibilityCallToolResultSchema,
    requestOptions?: RequestOptions,
    clientNames?: string[]
  ): Promise<CallToolResult>;

  /**
   * Gets the list of client names that support a specific tool
   * @param toolName - Name of the tool
   */
  getClientsForTool(toolName: string): Promise<string[]>;

  /**
   * Gets the list of clients with their metadata that support a specific tool
   * @param toolName - Name of the tool
   */
  getClientsInfoForTool(toolName: string): Promise<Map<string, MCPClientMetadata>>;
}
