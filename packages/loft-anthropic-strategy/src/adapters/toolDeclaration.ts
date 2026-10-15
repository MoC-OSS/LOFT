import Anthropic from '@anthropic-ai/sdk';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Converts MCP tools to Anthropic tools format for declarations in the request
 */
export function convertMcpToolToAnthropicTool(mcpTools: ListToolsResult['tools']): Array<Anthropic.Tool> {
  if (!mcpTools || mcpTools.length === 0) {
    return [];
  }

  return mcpTools.map((tool) => {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: tool.inputSchema.properties || {},
        required: tool.inputSchema.required || []
      }
    };
  });
}

/**
 * Prepares tool choice configuration based on tool options
 */
export function prepareToolChoice(toolChoice?: any): Anthropic.ToolChoice | undefined {
  if (!toolChoice) {
    return undefined;
  }

  // Default to auto if not specified
  return {
    type: 'auto'
  };
}
