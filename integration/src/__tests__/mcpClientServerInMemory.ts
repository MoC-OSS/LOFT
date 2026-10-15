// src/inline.ts
import { ContextInterface } from '@moc-global/loft-definitions';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/* ---------- Function to create a new server instance ---------- */
const createCalculatorServer = () => {
  const server = new McpServer({ name: 'calculator', version: '0.1.0' });

  server.resource('calculator-info', new ResourceTemplate('calculator://info', { list: undefined }), async (uri) => ({
    contents: [{ uri: uri.href, text: `Simple calculator with basic operations` }]
  }));

  // Add calculator operations
  server.tool(
    'add',
    {
      a: z.number(),
      b: z.number(),
      // Define an optional context parameter of any type that will hold the ContextInterface
      context: z.any().optional()
    },
    async ({ a, b, context }) => {
      // Access the context if provided
      if (context) {
        // You can now use the context here
        console.log(`Session ID: ${(context as ContextInterface).session.id}`);
      }
      return {
        content: [{ type: 'text', text: String(a + b) }]
      };
    }
  );

  server.tool(
    'subtract',
    {
      a: z.number(),
      b: z.number(),
      context: z.any().optional()
    },
    async ({ a, b, context }) => {
      if (context) {
        console.log(`Session ID: ${(context as ContextInterface).session.id}`);
      }
      return {
        content: [{ type: 'text', text: String(a - b) }]
      };
    }
  );

  server.tool(
    'multiply',
    {
      a: z.number(),
      b: z.number(),
      context: z.any().optional()
    },
    async ({ a, b, context }) => {
      if (context) {
        console.log(`Session ID: ${(context as ContextInterface).session.id}`);
      }
      return {
        content: [{ type: 'text', text: String(a * b) }]
      };
    }
  );

  server.tool(
    'divide',
    {
      a: z.number(),
      b: z.number(),
      context: z.any().optional()
    },
    async ({ a, b, context }) => {
      if (context) {
        console.log(`Session ID: ${(context as ContextInterface).session.id}`);
      }

      if (b === 0) {
        return {
          content: [{ type: 'text', text: 'Error: Division by zero' }]
        };
      }
      return {
        content: [{ type: 'text', text: String(a / b) }]
      };
    }
  );

  return server;
};

/* ---------- Create unique client-server pair for each call ---------- */
export const InitClientServer = async () => {
  // Create new server instance for each call
  const server = createCalculatorServer();

  // Create new transport pair for each call
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  // Connect server
  await server.connect(serverTransport);

  // Create and connect client
  const client = new Client({ name: 'calculator-client', version: '0.1.0' });
  await client.connect(clientTransport);

  // Return the initialized client
  return client;
};

// Example usage:
// const runCalculator = async () => {
//   const client = await InitClientServer();
//
//   // Get calculator info
//   const info = await client.readResource({ uri: 'calculator://info' });
//   console.log(info.contents[0].text);
//
//   // Example operations with context
//   const context = { session: { id: 'test-session-id' } };
//   const addResult = await client.callTool({ name: 'add', arguments: { a: 5, b: 3, context } });
//   const subtractResult = await client.callTool({ name: 'subtract', arguments: { a: 10, b: 4, context } });
//   const multiplyResult = await client.callTool({ name: 'multiply', arguments: { a: 6, b: 7, context } });
//   const divideResult = await client.callTool({ name: 'divide', arguments: { a: 20, b: 5, context } });
//
//   console.log('5 + 3 =', addResult.content?.[0]?.text);
//   console.log('10 - 4 =', subtractResult.content?.[0]?.text);
//   console.log('6 * 7 =', multiplyResult.content?.[0]?.text);
//   console.log('20 / 5 =', divideResult.content?.[0]?.text);
// };
//
// runCalculator().catch(console.error);
