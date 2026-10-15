import { Interface } from '@moc-global/loft-definitions';
import { configureMockLoggerStrategy } from '@moc-global/loft-test-suite';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MCPManager } from '../../managers/MCPManager';

// Type guard for text content items
type TextContent = Extract<CallToolResult['content'][number], { type: 'text' }>;

function isTextContent(item: CallToolResult['content'][number]): item is TextContent {
  return item.type === 'text';
}

// Helper to extract text from content item (throws if not text type)
function getTextContent(item: CallToolResult['content'][number]): string {
  if (!isTextContent(item)) {
    throw new Error(`Expected text content but got ${item.type}`);
  }
  return item.text;
}

// Tool definition interface
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
  handler: (params: any) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
}

// Factory class to create MCP client-server pairs
class MCPClientServerFactory {
  private instances: Array<{
    server: Interface.MCP.McpServer;
    client: Interface.MCP.Client;
    serverTransport: Interface.MCP.InMemoryTransport;
    clientTransport: Interface.MCP.InMemoryTransport;
  }> = [];

  public async createClientServerPair(
    name: string,
    tools: ToolDefinition[] = [],
    resources: Array<{ name: string; content: string }> = []
  ): Promise<{ server: Interface.MCP.McpServer; client: Interface.MCP.Client }> {
    // Create server
    const server = new Interface.MCP.McpServer({
      name: `${name}-server`,
      version: '1.0.0'
    });

    // Add tools to server
    for (const tool of tools) {
      const schema: Record<string, any> = {};

      // Build zod schema from inputSchema properties
      if (tool.inputSchema?.properties) {
        for (const [key, prop] of Object.entries(tool.inputSchema.properties)) {
          const propDef = prop as any;
          switch (propDef.type) {
            case 'string':
              schema[key] = z.string().optional();
              break;
            case 'number':
              schema[key] = z.number().optional();
              break;
            case 'boolean':
              schema[key] = z.boolean().optional();
              break;
            default:
              schema[key] = z.any().optional();
          }
        }
      }

      // Add catch-all for any additional parameters
      schema.additionalParams = z.any().optional();

      server.tool(tool.name, tool.description, async () => {
        const result = await tool.handler({});
        return {
          ...(result.isError ? { isError: true } : {}),
          content: result.content.map((item) => ({
            type: 'text' as const,
            text: item.text
          }))
        };
      });
    }

    // Add resources to server
    for (const resource of resources) {
      server.resource(resource.name, `test://${resource.name}`, async () => ({
        contents: [{ uri: `test://${resource.name}`, text: resource.content }]
      }));
    }

    // Create transport pair
    const [clientTransport, serverTransport] = Interface.MCP.InMemoryTransport.createLinkedPair();

    // Connect server
    await server.connect(serverTransport);

    // Create and connect client
    const client = new Interface.MCP.Client({
      name: `${name}-client`,
      version: '1.0.0'
    });
    await client.connect(clientTransport);

    // Store instance for cleanup
    this.instances.push({ server, client, serverTransport, clientTransport });

    return { server, client };
  }

  public async cleanup() {
    // Close all connections
    for (const instance of this.instances) {
      try {
        await instance.server.close();
        await instance.client.close();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    this.instances = [];
  }
}

describe('MCPManager', () => {
  let mcpManager: MCPManager;
  const mockLoggerStrategy = configureMockLoggerStrategy(Interface.LogLevel.DEBUG);
  let factory: MCPClientServerFactory;
  let client1: Interface.MCP.Client;
  let client2: Interface.MCP.Client;
  let client3: Interface.MCP.Client;

  beforeEach(async () => {
    vi.clearAllMocks();
    mcpManager = new MCPManager();
    factory = new MCPClientServerFactory();

    // Create first client-server pair with tools
    const { client: c1 } = await factory.createClientServerPair('Server1', [
      {
        name: 'tool1',
        description: 'Test tool 1',
        inputSchema: {
          type: 'object',
          properties: {
            param1: { type: 'string' }
          }
        },
        handler: async () => ({
          content: [{ type: 'text', text: 'Result from tool1' }]
        })
      },
      {
        name: 'commonTool',
        description: 'Common tool with same schema',
        inputSchema: {
          type: 'object',
          properties: {
            param1: { type: 'string' }
          }
        },
        handler: async () => ({
          content: [{ type: 'text', text: 'Common tool result from server1' }]
        })
      }
    ]);

    // Create second client-server pair with different tools
    const { client: c2 } = await factory.createClientServerPair('Server2', [
      {
        name: 'tool2',
        description: 'Test tool 2',
        inputSchema: {
          type: 'object',
          properties: {
            param2: { type: 'number' }
          }
        },
        handler: async () => ({
          content: [{ type: 'text', text: 'Result from tool2' }]
        })
      },
      {
        name: 'commonTool',
        description: 'Common tool with same schema',
        inputSchema: {
          type: 'object',
          properties: {
            param1: { type: 'string' }
          }
        },
        handler: async () => ({
          content: [{ type: 'text', text: 'Common tool result from server2' }]
        })
      },
      {
        name: 'conflictTool',
        description: 'Tool with conflicting schema',
        inputSchema: {
          type: 'object',
          properties: {
            conflict: { type: 'string' }
          }
        },
        handler: async () => ({
          content: [{ type: 'text', text: 'Result from conflicting tool' }]
        })
      }
    ]);

    // Create third client-server pair for conflict testing
    const { client: c3 } = await factory.createClientServerPair('Server3', [
      {
        name: 'conflictTool',
        description: 'Tool with different schema',
        inputSchema: {
          type: 'object',
          properties: {
            differentParam: { type: 'boolean' }
          }
        },
        handler: async () => ({
          content: [{ type: 'text', text: 'Result from server3 conflicting tool' }]
        })
      }
    ]);

    client1 = c1;
    client2 = c2;
    client3 = c3;
  });

  afterEach(async () => {
    await factory.cleanup();
  });

  // 1. New Client Registration
  describe('Client Registration', () => {
    it('should successfully register a client', async () => {
      await mcpManager.useClient('Server1', client1);

      expect(mockLoggerStrategy.info).toHaveBeenCalledWith(
        'MCP client "Server1" successfully registered with 2 tools',
        'MCPManager'
      );
    });

    it('should add client tools to cache maps', async () => {
      await mcpManager.useClient('Server1', client1);

      const tools = await mcpManager.listTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((tool) => tool.name)).toContain('tool1');
      expect(tools.map((tool) => tool.name)).toContain('commonTool');
    });
  });

  // 2. Retrieving Tool Lists
  describe('Tool Listing', () => {
    beforeEach(async () => {
      await mcpManager.useClient('Server1', client1);
      await mcpManager.useClient('Server2', client2);
    });

    it('should return correct list of tools with listTools()', async () => {
      const tools = await mcpManager.listTools();

      expect(tools).toHaveLength(4); // tool1, tool2, commonTool (canonical), conflictTool
      expect(tools.map((tool) => tool.name).sort()).toEqual(['commonTool', 'conflictTool', 'tool1', 'tool2']);
    });

    it('should return structured lists by client with listsOfTools()', async () => {
      const toolLists = await mcpManager.listsOfTools();

      expect(toolLists).toHaveLength(2);
      expect(toolLists[0].tools).toBeDefined();
      expect(toolLists[1].tools).toBeDefined();
    });
  });

  // 3. Basic Tool Invocation
  describe('Basic Tool Invocation', () => {
    beforeEach(async () => {
      await mcpManager.useClient('Server1', client1);
      await mcpManager.useClient('Server2', client2);
    });

    it('should successfully invoke a tool supported by a single client', async () => {
      const result = await mcpManager.callTool({ name: 'tool1', arguments: { param1: 'test' } });

      expect(result).toBeDefined();
      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
      expect(getTextContent(result.content[0])).toEqual('Result from tool1');
    });

    it('should correctly return the result', async () => {
      const result = await mcpManager.callTool({ name: 'tool2', arguments: { param2: 42 } });

      expect(result).toBeDefined();
      expect(result.content).toHaveLength(1);
      expect(getTextContent(result.content[0])).toEqual('Result from tool2');
    });
  });

  // 4. Tool Invocation Routing
  describe('Tool Invocation Routing', () => {
    beforeEach(async () => {
      await mcpManager.useClient('Server1', client1);
      await mcpManager.useClient('Server2', client2);

      // Spy on client.callTool
      vi.spyOn(client1, 'callTool');
      vi.spyOn(client2, 'callTool');
    });

    it('should only invoke a tool on clients that support it', async () => {
      await mcpManager.callTool({ name: 'tool1', arguments: { param1: 'test' } });

      expect(client1.callTool).toHaveBeenCalledTimes(1);
      expect(client2.callTool).not.toHaveBeenCalled();
    });

    it('should correctly route requests to appropriate clients', async () => {
      await mcpManager.callTool({ name: 'tool2', arguments: { param2: 42 } });

      expect(client1.callTool).not.toHaveBeenCalled();
      expect(client2.callTool).toHaveBeenCalledTimes(1);
      expect(client2.callTool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'tool2',
          arguments: { param2: 42 }
        }),
        undefined,
        undefined
      );
    });
  });

  // 5. Duplicate Tool Invocation
  describe('Duplicate Tool Invocation', () => {
    beforeEach(async () => {
      await mcpManager.useClient('Server1', client1);
      await mcpManager.useClient('Server2', client2);

      vi.spyOn(client1, 'callTool');
      vi.spyOn(client2, 'callTool');
    });

    it('should invoke a tool with the same name on all supporting clients', async () => {
      await mcpManager.callTool({ name: 'commonTool', arguments: { param1: 'test' } });

      expect(client1.callTool).toHaveBeenCalledTimes(1);
      expect(client2.callTool).toHaveBeenCalledTimes(1);
    });

    it('should aggregate results from different clients', async () => {
      const result = await mcpManager.callTool({ name: 'commonTool', arguments: { param1: 'test' } });

      expect(result.content).toHaveLength(2);
      expect(getTextContent(result.content[0])).toContain('Common tool result');
      expect(getTextContent(result.content[1])).toContain('Common tool result');

      // Verify both server results are included
      const textContents = result.content.filter(isTextContent).map((item) => item.text);
      expect(textContents).toContain('Common tool result from server1');
      expect(textContents).toContain('Common tool result from server2');
    });
  });

  // 6. Non-existent Tool Invocation
  describe('Non-existent Tool Invocation', () => {
    beforeEach(async () => {
      await mcpManager.useClient('Server1', client1);
      await mcpManager.useClient('Server2', client2);

      vi.spyOn(client1, 'callTool');
      vi.spyOn(client2, 'callTool');
    });

    it('should return error with isError:true for non-existent tool', async () => {
      const result = await mcpManager.callTool({ name: 'nonExistentTool', arguments: {} });

      expect(result.isError).toBeTruthy();
      expect(result.error).toContain('Tool "nonExistentTool" not registered');
    });

    it('should not make unnecessary API calls for non-existent tools', async () => {
      await mcpManager.callTool({ name: 'nonExistentTool', arguments: {} });

      expect(client1.callTool).not.toHaveBeenCalled();
      expect(client2.callTool).not.toHaveBeenCalled();
    });
  });

  // 7. Error During Tool Invocation
  describe('Error During Tool Invocation', () => {
    beforeEach(async () => {
      await mcpManager.useClient('Server1', client1);

      // Make client1.callTool throw an error
      vi.spyOn(client1, 'callTool').mockRejectedValueOnce(new Error('Test error'));
    });

    it('should handle errors when a client throws an exception', async () => {
      const result = await mcpManager.callTool({ name: 'tool1', arguments: { param1: 'test' } });

      expect(result.isError).toBeTruthy();
      expect(result.error).toContain('No valid MCP results found');
    });

    it('should aggregate result with isError:true', async () => {
      const result = await mcpManager.callTool({ name: 'tool1', arguments: { param1: 'test' } });

      expect(result.isError).toBeTruthy();
      expect(result.content).toEqual([{ type: 'text', text: 'Tool execution failed with errors: Test error' }]);
    });
  });

  describe('Tool that reports an error', () => {
    beforeEach(async () => {
      const { client: failingClient } = await factory.createClientServerPair('FailingServer', [
        {
          name: 'bookTable',
          description: 'Tool that reports a failure',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ isError: true, content: [{ type: 'text', text: 'No table free at 19:00' }] })
        },
        {
          name: 'silentFailure',
          description: 'Tool that fails without details',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ isError: true, content: [] })
        }
      ]);
      await mcpManager.useClient('FailingServer', failingClient);
    });

    it("should pass the tool's error text through", async () => {
      const result = await mcpManager.callTool({ name: 'bookTable', arguments: {} });

      expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'No table free at 19:00' }] });
    });

    it('should explain a failure that has no content', async () => {
      const result = await mcpManager.callTool({ name: 'silentFailure', arguments: {} });

      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        {
          type: 'text',
          text: 'Tool execution failed with errors: Tool returned empty content'
        }
      ]);
    });

    it('logs the arguments and the error content at DEBUG only', async () => {
      vi.mocked(mockLoggerStrategy.debug).mockClear();
      for (const level of ['info', 'warn', 'error'] as const) vi.mocked(mockLoggerStrategy[level]).mockClear();

      await mcpManager.callTool({ name: 'bookTable', arguments: { guest: 'GUEST-NAME' } });

      for (const level of ['info', 'warn', 'error'] as const) {
        const logged = JSON.stringify(vi.mocked(mockLoggerStrategy[level]).mock.calls);
        expect(logged).not.toContain('GUEST-NAME');
        expect(logged).not.toContain('No table free');
      }
      const debugLogged = JSON.stringify(vi.mocked(mockLoggerStrategy.debug).mock.calls);
      expect(debugLogged).toContain('GUEST-NAME');
      expect(debugLogged).toContain('No table free');
    });
  });

  // 8. Invalid Result Format
  describe('Invalid Result Format', () => {
    beforeEach(async () => {
      // Create a client with tool that returns invalid format
      const { client: invalidClient } = await factory.createClientServerPair('InvalidServer', [
        {
          name: 'invalidTool',
          description: 'Tool with invalid response',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({
            content: 'Not an array' as any // Invalid format
          })
        }
      ]);

      await mcpManager.useClient('InvalidServer', invalidClient);
    });

    it('should handle cases when a client returns incorrect response format', async () => {
      const result = await mcpManager.callTool({ name: 'invalidTool', arguments: {} });

      expect(result.isError).toBeTruthy();
    });

    it('should log errors properly', async () => {
      await mcpManager.callTool({ name: 'invalidTool', arguments: {} });

      expect(mockLoggerStrategy.error).toHaveBeenCalled();
      expect((mockLoggerStrategy.error as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('Tool call failed');
    });
  });

  // 9. Cache Update for Stale Data
  describe('Cache Update for Stale Data', () => {
    beforeEach(async () => {
      // Spy on listTools method BEFORE registering client
      vi.spyOn(client1, 'listTools');

      await mcpManager.useClient('Server1', client1);

      // Access private property for testing
      (mcpManager as any).TOOL_CACHE_TTL = 50; // 50ms TTL for testing
    });

    it('should update cache when TTL has expired', async () => {
      // Initial call
      await mcpManager.callTool({ name: 'tool1', arguments: { param1: 'test' } });

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Second call should refresh cache
      await mcpManager.callTool({ name: 'tool1', arguments: { param1: 'test' } });

      // listTools should be called at least 2 times (once during useClient, then refresh)
      expect(client1.listTools).toHaveBeenCalledTimes(2);
    });
  });

  // 10. Working with Multiple Clients
  describe('Working with Multiple Clients', () => {
    it('should work correctly with multiple MCP clients', async () => {
      // Register multiple clients
      await mcpManager.useClient('Server1', client1);
      await mcpManager.useClient('Server2', client2);

      // Get all tools
      const tools = await mcpManager.listTools();

      // Should have tools from both clients
      expect(tools.length).toBeGreaterThanOrEqual(4);

      // Call a tool from each client
      const result1 = await mcpManager.callTool({ name: 'tool1', arguments: { param1: 'test' } });
      const result2 = await mcpManager.callTool({ name: 'tool2', arguments: { param2: 42 } });

      expect(result1.isError).toBeFalsy();
      expect(result2.isError).toBeFalsy();
    });
  });

  // 11. Empty Results Processing
  describe('Empty Results Processing', () => {
    beforeEach(async () => {
      // Create clients with empty and mixed results
      const { client: emptyClient1 } = await factory.createClientServerPair('EmptyServer1', [
        {
          name: 'emptyTool',
          description: 'Tool with empty results',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [] })
        },
        {
          name: 'mixedTool',
          description: 'Tool with mixed results',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [] })
        }
      ]);

      const { client: emptyClient2 } = await factory.createClientServerPair('EmptyServer2', [
        {
          name: 'emptyTool',
          description: 'Tool with empty results',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [] })
        },
        {
          name: 'mixedTool',
          description: 'Tool with mixed results',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({
            content: [{ type: 'text', text: 'Non-empty result' }]
          })
        }
      ]);

      await mcpManager.useClient('EmptyServer1', emptyClient1);
      await mcpManager.useClient('EmptyServer2', emptyClient2);
    });

    it('should treat an empty successful result as success with empty content', async () => {
      const result = await mcpManager.callTool({ name: 'emptyTool', arguments: {} });

      expect(result.isError).toBeFalsy();
      expect(result.content).toEqual([]);
    });

    it('should handle aggregation when some results are empty and some are not', async () => {
      const result = await mcpManager.callTool({ name: 'mixedTool', arguments: {} });

      expect(result.content).toHaveLength(1);
      expect(getTextContent(result.content[0])).toEqual('Non-empty result');
    });
  });

  // 12. Client Registration with Identical Tools
  describe('Client Registration with Identical Tools', () => {
    it('should log warnings about duplicates', async () => {
      await mcpManager.useClient('Server1', client1);
      await mcpManager.useClient('Server2', client2);

      expect(mockLoggerStrategy.info).toHaveBeenCalledWith(expect.stringContaining('Tool registered'), 'MCPManager');
    });

    it('should work correctly with duplicates', async () => {
      await mcpManager.useClient('Server1', client1);
      await mcpManager.useClient('Server2', client2);

      const result = await mcpManager.callTool({ name: 'commonTool', arguments: { param1: 'test' } });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(2);
    });
  });

  // 13. Tool Set Changes without Notification
  describe('Tool Set Changes without Notification', () => {
    it('should detect changes through the TTL mechanism', async () => {
      // Create a client that can have tools added dynamically
      const { server, client } = await factory.createClientServerPair('DynamicServer', [
        {
          name: 'initialTool',
          description: 'Initial tool',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({
            content: [{ type: 'text', text: 'Initial tool result' }]
          })
        }
      ]);

      await mcpManager.useClient('DynamicServer', client);

      // Set short TTL
      (mcpManager as any).TOOL_CACHE_TTL = 10;

      // First call with original tools
      const result1 = await mcpManager.callTool({ name: 'initialTool', arguments: {} });
      expect(result1.isError).toBeFalsy();

      // Add a new tool to the server
      server.tool('newTool', 'New tool description', async () => ({
        content: [{ type: 'text' as const, text: 'Result from new tool' }]
      }));

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 15));

      // This call should now be able to access the new tool
      const result2 = await mcpManager.callTool({ name: 'newTool', arguments: {} });

      expect(result2.isError).toBeFalsy();
      expect(getTextContent(result2.content[0])).toEqual('Result from new tool');
    });
  });

  // 14. Invoking Tools with Identical Names across Different Clients
  describe('Invoking Tools with Identical Names across Different Clients', () => {
    beforeEach(async () => {
      await mcpManager.useClient('Server1', client1);
      await mcpManager.useClient('Server2', client2);
    });

    it('should invoke the tool on all clients that support it', async () => {
      vi.spyOn(client1, 'callTool');
      vi.spyOn(client2, 'callTool');

      await mcpManager.callTool({ name: 'commonTool', arguments: { param1: 'test' } });

      expect(client1.callTool).toHaveBeenCalledTimes(1);
      expect(client2.callTool).toHaveBeenCalledTimes(1);
    });

    it('should correctly merge results from different clients', async () => {
      const result = await mcpManager.callTool({ name: 'commonTool', arguments: { param1: 'test' } });

      expect(result.content).toHaveLength(2);

      // Results should contain data from both servers
      const texts = result.content.filter(isTextContent).map((item) => item.text);
      expect(texts).toContain('Common tool result from server1');
      expect(texts).toContain('Common tool result from server2');
    });

    it('should not be affected by client order', async () => {
      // Create a new manager and register clients in reverse order
      const reversedManager = new MCPManager();
      await reversedManager.useClient('Server2', client2);
      await reversedManager.useClient('Server1', client1);

      const result = await reversedManager.callTool({ name: 'commonTool', arguments: { param1: 'test' } });

      expect(result.content).toHaveLength(2);

      // Both results should be present regardless of client registration order
      const texts = result.content.filter(isTextContent).map((item) => item.text);
      expect(texts).toContain('Common tool result from server1');
      expect(texts).toContain('Common tool result from server2');
    });
  });

  // 15. Handling Tools with Identical Names but Different Parameters
  describe('Handling Tools with Identical Names but Different Parameters', () => {
    beforeEach(async () => {
      await mcpManager.useClient('Server2', client2);
      await mcpManager.useClient('Server3', client3);
    });

    it('should log warnings about parameter schema conflicts with canonical schema info', async () => {
      // The warning should have been logged during client registration
      expect(mockLoggerStrategy.warn).toHaveBeenCalledWith(
        'Tool Schema Conflict: "conflictTool"',
        'MCPManager',
        expect.stringContaining('has conflicting schema with existing tool')
      );

      // Should indicate which client's schema is canonical
      expect(mockLoggerStrategy.warn).toHaveBeenCalledWith(
        'Tool Schema Conflict: "conflictTool"',
        'MCPManager',
        expect.stringContaining('canonical schema from client "Server2" (registered first)')
      );
    });

    it('should still invoke the tool on all clients despite schema differences', async () => {
      const result = await mcpManager.callTool({
        name: 'conflictTool',
        arguments: { conflict: 'value', differentParam: true }
      });

      // Should still work and aggregate results
      expect(result.isError).toBeFalsy();
      expect(result.content.length).toBeGreaterThan(0);
    });

    it('should use canonical schema for tool listing', async () => {
      const tools = await mcpManager.listTools();
      const conflictTool = tools.find((tool) => tool.name === 'conflictTool');

      expect(conflictTool).toBeDefined();
      // Should use the schema and description from first registered client (Server2)
      expect(conflictTool?.description).toEqual('Tool with conflicting schema');
      // The schema should exist and have type object (canonical from Server2)
      expect(conflictTool?.inputSchema).toHaveProperty('type', 'object');
    });

    it('should log debug info about which canonical schema is used during tool calls', async () => {
      await mcpManager.callTool({
        name: 'conflictTool',
        arguments: { conflict: 'test' }
      });

      expect(mockLoggerStrategy.debug).toHaveBeenCalledWith(
        expect.stringContaining(
          'Tool "conflictTool" is supported by 2 clients. Using canonical schema from "Server2" for parameter validation.'
        ),
        'MCPManager'
      );
    });
  });

  // 16. Concurrent useClient Protection
  describe('Concurrent useClient Protection', () => {
    it('should throw error when useClient is called concurrently without await', async () => {
      // Start first useClient call without await
      const firstCall = mcpManager.useClient('Server1', client1);

      // Try to call useClient again immediately (without awaiting the first one)
      await expect(async () => {
        await mcpManager.useClient('Server2', client2);
      }).rejects.toThrow(
        "useClient method is already running. Please use 'await' when calling useClient to ensure sequential execution."
      );

      // Complete the first call
      await firstCall;
    });

    it('should log error when concurrent useClient call is detected', async () => {
      // Start first useClient call without await
      const firstCall = mcpManager.useClient('Server1', client1);

      // Try to call useClient again immediately
      try {
        await mcpManager.useClient('Server2', client2);
      } catch (error) {
        // Error is expected
      }

      expect(mockLoggerStrategy.error).toHaveBeenCalledWith(
        "useClient method is already running. Please use 'await' when calling useClient to ensure sequential execution.",
        'MCPManager',
        expect.any(Error)
      );

      // Complete the first call
      await firstCall;
    });

    it('should allow sequential useClient calls with proper await', async () => {
      // First call with await
      await mcpManager.useClient('Server1', client1);

      // Second call with await should work fine
      await expect(mcpManager.useClient('Server2', client2)).resolves.not.toThrow();

      // Verify both clients were registered successfully
      const tools = await mcpManager.listTools();
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should reset flag after successful useClient completion', async () => {
      // First call
      await mcpManager.useClient('Server1', client1);

      // Flag should be reset, so second call should work
      await expect(mcpManager.useClient('Server2', client2)).resolves.not.toThrow();
    });

    it('should reset flag even if useClient throws an error', async () => {
      // Create a client that will cause an error during registration
      const errorClient = {
        getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),
        listTools: vi.fn().mockRejectedValue(new Error('Client error')),
        callTool: vi.fn(),
        close: vi.fn()
      } as any;

      // First call that will fail
      await expect(mcpManager.useClient('ErrorServer', errorClient)).rejects.toThrow('Client error');

      // Flag should be reset despite the error, so next call should work
      await expect(mcpManager.useClient('Server1', client1)).resolves.not.toThrow();
    });

    it('registers a server without the tools capability with no tools, without calling tools/list', async () => {
      const resourcesOnly = {
        getServerCapabilities: vi.fn().mockReturnValue({ resources: {} }),
        listTools: vi.fn().mockRejectedValue(new Error('MCP error -32601: Method not found')),
        callTool: vi.fn(),
        close: vi.fn()
      } as any;

      await mcpManager.useClient('ResourcesOnly', resourcesOnly);

      expect(resourcesOnly.listTools).not.toHaveBeenCalled();
      expect(await mcpManager.listTools()).toEqual([]);
    });

    it('rejects a client that is not connected, which has no capabilities yet', async () => {
      const notConnected = {
        getServerCapabilities: vi.fn().mockReturnValue(undefined),
        listTools: vi.fn().mockRejectedValue(new Error('Not connected')),
        callTool: vi.fn(),
        close: vi.fn()
      } as unknown as Parameters<MCPManager['useClient']>[1];

      await expect(mcpManager.useClient('NotConnected', notConnected)).rejects.toThrow('Not connected');
    });

    it('should protect against multiple concurrent calls', async () => {
      // Start multiple useClient calls simultaneously
      const call1 = mcpManager.useClient('Server1', client1);
      const call2 = mcpManager.useClient('Server2', client2);
      const call3 = mcpManager.useClient('Server3', client3);

      // Only the first call should succeed, others should fail
      const results = await Promise.allSettled([call1, call2, call3]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(results[2].status).toBe('rejected');

      // Error messages should be about concurrent calls
      if (results[1].status === 'rejected') {
        expect(results[1].reason.message).toContain('useClient method is already running');
      }
      if (results[2].status === 'rejected') {
        expect(results[2].reason.message).toContain('useClient method is already running');
      }
    });

    it('should allow useClient calls after previous call completes', async () => {
      // First call
      await mcpManager.useClient('Server1', client1);

      // Wait a bit to ensure completion
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second call should work
      await expect(mcpManager.useClient('Server2', client2)).resolves.not.toThrow();

      // Third call should also work
      await expect(mcpManager.useClient('Server3', client3)).resolves.not.toThrow();
    });
  });

  // 17. Race Conditions in Concurrent Tool Calls
  describe('Race Conditions in Concurrent Tool Calls', () => {
    /*
     * These tests verify fixes for race conditions in tool mapping updates:
     * - Prevents tools from temporarily disappearing during updates
     * - Ensures concurrent tool calls work reliably
     * - Maintains tool mapping consistency during rapid refreshes
     * - Allows safe concurrent client registration and tool calls
     */
    let dynamicClient: Interface.MCP.Client;

    beforeEach(async () => {
      // Create a client with tools that we can manipulate
      const { client } = await factory.createClientServerPair('DynamicServer', [
        {
          name: 'raceTool',
          description: 'Tool for race condition testing',
          inputSchema: {
            type: 'object',
            properties: {
              param: { type: 'string' }
            }
          },
          handler: async () => ({
            content: [{ type: 'text', text: 'Race tool result' }]
          })
        }
      ]);

      dynamicClient = client;

      await mcpManager.useClient('DynamicServer', dynamicClient);

      // Set very short TTL to force frequent refreshes
      (mcpManager as any).TOOL_CACHE_TTL = 1; // 1ms TTL
    });

    it('should handle concurrent tool calls during cache refresh without losing tools', async () => {
      // Force cache to be stale by setting lastToolRefresh to past time
      // This is necessary because useClient() already called listTools() and set lastToolRefresh
      // Without this, the TTL check would prevent refresh from happening
      (mcpManager as any).lastToolRefresh.set('DynamicServer', Date.now() - 1000);

      // Mock listTools to simulate slow refresh that could cause race conditions
      const originalListTools = dynamicClient.listTools.bind(dynamicClient);
      let refreshCount = 0;

      vi.spyOn(dynamicClient, 'listTools').mockImplementation(async () => {
        refreshCount++;

        // Simulate slow network call during refresh
        await new Promise((resolve) => setTimeout(resolve, 10));

        return await originalListTools();
      });

      // Launch multiple concurrent tool calls that will trigger refreshes
      const concurrentCalls = Array.from({ length: 20 }, (_, i) =>
        mcpManager.callTool({
          name: 'raceTool',
          arguments: { param: `test-${i}` }
        })
      );

      // Wait for all calls to complete
      const results = await Promise.all(concurrentCalls);

      // All calls should succeed - none should fail due to race conditions
      for (let i = 0; i < results.length; i++) {
        expect(results[i].isError).toBeFalsy();
        expect(results[i].content).toHaveLength(1);
        expect(getTextContent(results[i].content[0])).toEqual('Race tool result');
      }

      // Should have triggered at least one refresh due to stale cache
      expect(refreshCount).toBeGreaterThanOrEqual(1);

      // Log that we successfully handled concurrent calls
      console.log(`Successfully handled ${concurrentCalls.length} concurrent calls with ${refreshCount} refreshes`);
    });

    it('should maintain tool mappings consistency during rapid client refreshes', async () => {
      // Create multiple clients with overlapping tools
      const { client: client1 } = await factory.createClientServerPair('RaceServer1', [
        {
          name: 'sharedTool',
          description: 'Shared tool',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'Result from server1' }] })
        }
      ]);

      const { client: client2 } = await factory.createClientServerPair('RaceServer2', [
        {
          name: 'sharedTool',
          description: 'Shared tool',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'Result from server2' }] })
        }
      ]);

      await mcpManager.useClient('RaceServer1', client1);
      await mcpManager.useClient('RaceServer2', client2);

      // Set very short TTL
      (mcpManager as any).TOOL_CACHE_TTL = 1;

      // Mock listTools to add delay and simulate race conditions
      vi.spyOn(client1, 'listTools').mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          tools: [
            {
              name: 'sharedTool',
              description: 'Shared tool',
              inputSchema: { type: 'object', properties: {} }
            }
          ]
        };
      });

      vi.spyOn(client2, 'listTools').mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          tools: [
            {
              name: 'sharedTool',
              description: 'Shared tool',
              inputSchema: { type: 'object', properties: {} }
            }
          ]
        };
      });

      // Launch many concurrent calls to the shared tool
      const concurrentCalls = Array.from({ length: 50 }, () =>
        mcpManager.callTool({
          name: 'sharedTool',
          arguments: {}
        })
      );

      const results = await Promise.all(concurrentCalls);

      // All calls should succeed
      for (const result of results) {
        expect(result.isError).toBeFalsy();
        // Should have results from both servers (2 content items) or at least one
        expect(result.content.length).toBeGreaterThanOrEqual(1);
      }

      // Verify that tool mappings are still consistent
      const finalTools = await mcpManager.listTools();
      const sharedTool = finalTools.find((tool) => tool.name === 'sharedTool');
      expect(sharedTool).toBeDefined();
    });

    it('should not lose tools temporarily during atomic mapping updates', async () => {
      // This test specifically targets the original race condition where tools
      // would temporarily disappear from toolToClientMap during refresh

      // Set very short TTL to force frequent refreshes
      (mcpManager as any).TOOL_CACHE_TTL = 1;

      // Launch many concurrent calls
      const concurrentCalls = Array.from({ length: 100 }, (_, i) =>
        mcpManager
          .callTool({
            name: 'raceTool',
            arguments: { param: `test-${i}` }
          })
          .catch((error) => ({
            isError: true,
            error: error.message,
            content: [],
            callIndex: i
          }))
      );

      const results = await Promise.all(concurrentCalls);

      // Count successful vs failed calls
      const successfulCalls = results.filter((r) => !r.isError).length;
      const failedCalls = results.filter((r) => r.isError).length;
      const totalCalls = concurrentCalls.length;

      console.log(`Concurrent calls: ${totalCalls}`);
      console.log(`Successful calls: ${successfulCalls}`);
      console.log(`Failed calls: ${failedCalls}`);

      // With the atomic mapping update fix, we should have very few or no failures
      // In the original buggy code, we would see many failures due to race conditions
      expect(successfulCalls).toBeGreaterThan(Math.floor(totalCalls * 0.9)); // At least 90% success rate

      // The atomic update should prevent tools from being temporarily lost
      expect(failedCalls).toBeLessThan(Math.floor(totalCalls * 0.1)); // Less than 10% failures
    });

    it('should handle rapid client registration and tool calls without data corruption', async () => {
      // This test simulates the scenario where new clients are being registered
      // while existing tools are being called, which could cause mapping corruption

      const testResults: Array<{ success: boolean; error?: string }> = [];

      // Function to register a new client
      const registerClient = async (index: number) => {
        try {
          const { client } = await factory.createClientServerPair(`RapidServer${index}`, [
            {
              name: `rapidTool${index}`,
              description: `Rapid tool ${index}`,
              inputSchema: { type: 'object', properties: {} },
              handler: async () => ({ content: [{ type: 'text', text: `Result from rapid tool ${index}` }] })
            },
            {
              name: 'commonRapidTool',
              description: 'Common rapid tool',
              inputSchema: { type: 'object', properties: {} },
              handler: async () => ({ content: [{ type: 'text', text: `Common result from server ${index}` }] })
            }
          ]);

          await mcpManager.useClient(`RapidServer${index}`, client);
          testResults.push({ success: true });
        } catch (error) {
          testResults.push({ success: false, error: (error as Error).message });
        }
      };

      // Function to call existing tools
      const callExistingTool = async () => {
        try {
          const result = await mcpManager.callTool({
            name: 'raceTool',
            arguments: { param: 'existing' }
          });
          testResults.push({ success: !result.isError });
        } catch (error) {
          testResults.push({ success: false, error: (error as Error).message });
        }
      };

      // Launch concurrent operations: registering new clients and calling existing tools
      const operations = [
        ...Array.from({ length: 5 }, (_, i) => registerClient(i)),
        ...Array.from({ length: 20 }, () => callExistingTool())
      ];

      await Promise.all(operations);

      // Analyze results
      const successCount = testResults.filter((r) => r.success).length;
      const failureCount = testResults.filter((r) => !r.success).length;

      console.log(`Total operations: ${testResults.length}`);
      console.log(`Successful operations: ${successCount}`);
      console.log(`Failed operations: ${failureCount}`);

      if (failureCount > 0) {
        const errors = testResults.filter((r) => !r.success).map((r) => r.error);
        console.log('Failure reasons:', [...new Set(errors)]);
      }

      // Should have high success rate with atomic updates
      expect(successCount).toBeGreaterThan(Math.floor(testResults.length * 0.8)); // At least 80% success

      // Verify final state is consistent
      const finalTools = await mcpManager.listTools();
      expect(finalTools.length).toBeGreaterThan(0);

      // Should have the original tool plus any successfully registered tools
      const toolNames = finalTools.map((t) => t.name);
      expect(toolNames).toContain('raceTool');
    });

    it('should gracefully handle refresh failures and preserve cached data', async () => {
      // This test specifically targets the scenario where refresh fails but cached data should be preserved
      // This was a potential race condition where failed refresh could corrupt tool mappings

      // First, ensure we have a working tool
      const initialResult = await mcpManager.callTool({
        name: 'raceTool',
        arguments: { param: 'initial' }
      });
      expect(initialResult.isError).toBeFalsy();

      // Mock listTools to fail after the first successful call
      const originalListTools = dynamicClient.listTools.bind(dynamicClient);
      let callCount = 0;
      let refreshFailureCount = 0;

      vi.spyOn(dynamicClient, 'listTools').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First call during useClient - return original result
          return await originalListTools();
        }
        // Subsequent calls (during refresh) - throw error
        refreshFailureCount++;
        throw new Error(`Simulated refresh failure ${refreshFailureCount}`);
      });

      // Force cache to be stale to trigger refresh attempts
      (mcpManager as any).lastToolRefresh.set('DynamicServer', Date.now() - 1000);
      (mcpManager as any).TOOL_CACHE_TTL = 1; // Very short TTL

      // Launch concurrent tool calls that will trigger refresh attempts
      const concurrentCalls = Array.from({ length: 30 }, (_, i) =>
        mcpManager.callTool({
          name: 'raceTool',
          arguments: { param: `concurrent-${i}` }
        })
      );

      const results = await Promise.all(concurrentCalls);

      // All calls should succeed despite refresh failures
      // This verifies that cached data is preserved when refresh fails
      for (let i = 0; i < results.length; i++) {
        expect(results[i].isError).toBeFalsy();
        expect(results[i].content).toHaveLength(1);
        expect(getTextContent(results[i].content[0])).toEqual('Race tool result');
      }

      // Should have attempted refreshes and failed
      expect(refreshFailureCount).toBeGreaterThan(0);

      // Should have logged warnings about failed refreshes
      expect(mockLoggerStrategy.warn).toHaveBeenCalledWith(
        'Failed to refresh tools for client "DynamicServer"',
        'MCPManager',
        expect.any(Error)
      );

      console.log(
        `Successfully handled ${concurrentCalls.length} concurrent calls despite ${refreshFailureCount} refresh failures`
      );

      // Verify that tool mappings are still intact after refresh failures
      const finalTools = await mcpManager.listTools();
      const raceTool = finalTools.find((tool) => tool.name === 'raceTool');
      expect(raceTool).toBeDefined();

      // One more call should still work
      const finalResult = await mcpManager.callTool({ name: 'raceTool', arguments: { param: 'final' } });
      expect(finalResult.isError).toBeFalsy();
    });
  });
});
