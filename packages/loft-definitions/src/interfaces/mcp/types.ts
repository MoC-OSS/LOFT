import type { CallToolResult, CompatibilityCallToolResult } from '@modelcontextprotocol/sdk/types.js';

export { Client } from '@modelcontextprotocol/sdk/client/index.js';
export { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
export { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
export type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';

// Only export our own wrapper types, not the original SDK types
export type CallToolReturn = CallToolResult | CompatibilityCallToolResult;

/**
 * Metadata for MCP clients registered with LOFT
 * Includes auto-added fields by LOFT and allows custom fields
 */
export interface MCPClientMetadata {
  // Auto-added by LOFT
  /** Auto-detected transport type: stdio, sse, websocket, streamable-http, etc. */
  transportType: string;
  /** ISO timestamp when the client was registered */
  registeredAt: string;
  /** Number of tools this client provides */
  toolCount: number;

  // Allow any additional custom fields
  [key: string]: any;
}
