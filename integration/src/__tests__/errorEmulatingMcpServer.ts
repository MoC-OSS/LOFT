import { ContextInterface } from '@moc-global/loft-definitions';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export interface ErrorConfig {
  shouldDisconnect: boolean;
  shouldReturnMalformedResponse: boolean;
  shouldReturnPartialResponse: boolean;
  shouldReturnEmptyResponse: boolean;
  shouldThrowException: boolean;
  missingToolNames: string[];
  extraToolResults: boolean;
}

/* ---------- Function to create error emulating server instance ---------- */
const createErrorEmulatingServer = (
  errorConfig: ErrorConfig = {
    shouldDisconnect: false,
    shouldReturnMalformedResponse: false,
    shouldReturnPartialResponse: false,
    shouldReturnEmptyResponse: false,
    shouldThrowException: false,
    missingToolNames: [],
    extraToolResults: false
  }
) => {
  const server = new McpServer({ name: 'error-emulator', version: '0.1.0' });

  server.resource(
    'error-emulator-info',
    new ResourceTemplate('error-emulator://info', { list: undefined }),
    async (uri) => ({
      contents: [{ uri: uri.href, text: `Error emulating MCP server for testing tool chain integrity` }]
    })
  );

  // Normal tool that works correctly
  server.tool(
    'test_normal',
    {
      value: z.string(),
      context: z.any().optional()
    },
    async ({ value, context }) => {
      if (context) {
        console.log(`Session ID: ${(context as ContextInterface).session.id}`);
      }
      return {
        content: [{ type: 'text' as const, text: `Normal response: ${value}` }]
      };
    }
  );

  // Tool that returns malformed response
  server.tool(
    'test_malformed',
    {
      value: z.string(),
      context: z.any().optional()
    },
    async ({ value }: { value: string }) => {
      if (errorConfig.shouldReturnMalformedResponse) {
        // Return malformed response - missing required fields or wrong structure
        return {
          invalidField: 'this should not be here',
          content: 'this should be an array'
        } as any;
      }
      return {
        content: [{ type: 'text' as const, text: `Malformed test: ${value}` }]
      };
    }
  );

  // Tool that returns partial response (incomplete content)
  server.tool(
    'test_partial',
    {
      value: z.string(),
      context: z.any().optional()
    },
    async ({ value }: { value: string }) => {
      if (errorConfig.shouldReturnPartialResponse) {
        // Return partial response - missing content items
        return {
          content: [] // Empty content array
        };
      }
      return {
        content: [
          { type: 'text' as const, text: `First part: ${value}` },
          { type: 'text' as const, text: `Second part: ${value}` }
        ]
      };
    }
  );

  // Tool that returns empty response
  server.tool(
    'test_empty',
    {
      value: z.string(),
      context: z.any().optional()
    },
    async ({ value }) => {
      if (errorConfig.shouldReturnEmptyResponse) {
        // Return completely empty response
        return {} as any;
      }
      return {
        content: [{ type: 'text', text: `Empty test: ${value}` }]
      };
    }
  );

  // Tool that throws exception
  server.tool(
    'test_exception',
    {
      value: z.string(),
      context: z.any().optional()
    },
    async ({ value }) => {
      if (errorConfig.shouldThrowException) {
        throw new Error(`Simulated exception for value: ${value}`);
      }
      return {
        content: [{ type: 'text', text: `Exception test: ${value}` }]
      };
    }
  );

  // Tool that simulates disconnection
  server.tool(
    'test_disconnect',
    {
      value: z.string(),
      context: z.any().optional()
    },
    async ({ value }) => {
      if (errorConfig.shouldDisconnect) {
        // Simulate connection drop by throwing a connection error
        const error = new Error('Connection lost');
        (error as any).code = 'ECONNRESET';
        throw error;
      }
      return {
        content: [{ type: 'text', text: `Disconnect test: ${value}` }]
      };
    }
  );

  // Tool that may not be available (for testing missing tools)
  if (!errorConfig.missingToolNames.includes('test_missing')) {
    server.tool(
      'test_missing',
      {
        value: z.string(),
        context: z.any().optional()
      },
      async ({ value }) => {
        return {
          content: [{ type: 'text', text: `Missing test: ${value}` }]
        };
      }
    );
  }

  // Tool for testing multiple responses (extra tool results)
  server.tool(
    'test_multiple',
    {
      value: z.string(),
      context: z.any().optional()
    },
    async ({ value }) => {
      if (errorConfig.extraToolResults) {
        // This could be used to simulate scenarios where a tool generates multiple responses
        // For now, we'll return a normal response but the test logic can handle multiple calls
        return {
          content: [
            { type: 'text', text: `Multiple test part 1: ${value}` },
            { type: 'text', text: `Multiple test part 2: ${value}` }
          ]
        };
      }
      return {
        content: [{ type: 'text', text: `Multiple test: ${value}` }]
      };
    }
  );

  return server;
};

/* ---------- Create unique client-server pair for each call ---------- */
export const InitErrorEmulatingClientServer = async (errorConfig?: ErrorConfig) => {
  // Create new server instance for each call
  const server = createErrorEmulatingServer(errorConfig);

  // Create new transport pair for each call
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  // Connect server
  await server.connect(serverTransport);

  // Create and connect client
  const client = new Client({ name: 'error-emulator-client', version: '0.1.0' });
  await client.connect(clientTransport);

  // Return the initialized client and server for potential manipulation
  return { client, server };
};

/* ---------- Helper functions for testing specific error scenarios ---------- */

export const createDisconnectingClient = async () => {
  return InitErrorEmulatingClientServer({
    shouldDisconnect: true,
    shouldReturnMalformedResponse: false,
    shouldReturnPartialResponse: false,
    shouldReturnEmptyResponse: false,
    shouldThrowException: false,
    missingToolNames: [],
    extraToolResults: false
  });
};

export const createMalformedResponseClient = async () => {
  return InitErrorEmulatingClientServer({
    shouldDisconnect: false,
    shouldReturnMalformedResponse: true,
    shouldReturnPartialResponse: false,
    shouldReturnEmptyResponse: false,
    shouldThrowException: false,
    missingToolNames: [],
    extraToolResults: false
  });
};

export const createPartialResponseClient = async () => {
  return InitErrorEmulatingClientServer({
    shouldDisconnect: false,
    shouldReturnMalformedResponse: false,
    shouldReturnPartialResponse: true,
    shouldReturnEmptyResponse: false,
    shouldThrowException: false,
    missingToolNames: [],
    extraToolResults: false
  });
};

export const createEmptyResponseClient = async () => {
  return InitErrorEmulatingClientServer({
    shouldDisconnect: false,
    shouldReturnMalformedResponse: false,
    shouldReturnPartialResponse: false,
    shouldReturnEmptyResponse: true,
    shouldThrowException: false,
    missingToolNames: [],
    extraToolResults: false
  });
};

export const createExceptionThrowingClient = async () => {
  return InitErrorEmulatingClientServer({
    shouldDisconnect: false,
    shouldReturnMalformedResponse: false,
    shouldReturnPartialResponse: false,
    shouldReturnEmptyResponse: false,
    shouldThrowException: true,
    missingToolNames: [],
    extraToolResults: false
  });
};

export const createMissingToolsClient = async (missingToolNames: string[] = ['test_missing']) => {
  return InitErrorEmulatingClientServer({
    shouldDisconnect: false,
    shouldReturnMalformedResponse: false,
    shouldReturnPartialResponse: false,
    shouldReturnEmptyResponse: false,
    shouldThrowException: false,
    missingToolNames,
    extraToolResults: false
  });
};

export const createExtraResultsClient = async () => {
  return InitErrorEmulatingClientServer({
    shouldDisconnect: false,
    shouldReturnMalformedResponse: false,
    shouldReturnPartialResponse: false,
    shouldReturnEmptyResponse: false,
    shouldThrowException: false,
    missingToolNames: [],
    extraToolResults: true
  });
};
