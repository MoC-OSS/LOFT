import { Chat, type ContextInterface, type GenerateRequestParameters } from '@moc-global/loft-definitions';
import { configureMockLoggerStrategy } from '@moc-global/loft-test-suite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { applyMiddleware } from '../applyMiddleware';
import { maskTracer } from '../maskTracer';
import { guardMcpClient, guardTool, guardTools, TOOL_GUARD_FAILED_TEXT } from '../tools';
import type { LoftMiddleware, ToolInfo, ToolOutput } from '../types';
import { RecordingTracerFactory } from './recordingTracer';

const logger = configureMockLoggerStrategy();

const upperResults: LoftMiddleware = {
  name: 'upper',
  toolResult: (output) => ({
    ...output,
    content: output.content.map((part) => (part.type === 'text' ? { ...part, text: part.text.toUpperCase() } : part))
  })
};

const failing: LoftMiddleware = {
  name: 'failing',
  toolResult: () => {
    throw new Error('detector down');
  }
};

function additionalTool(handler: Chat.AdditionalTool['handler']): Chat.AdditionalTool {
  return {
    definition: {
      name: 'lookup',
      description: 'Looks something up',
      inputSchema: { type: Chat.AdditionalToolSchemaType.OBJECT }
    },
    handler
  };
}

const text = (value: string) => ({ type: Chat.AdditionalToolContentType.TEXT, text: value });

async function connectedClient() {
  const server = new McpServer({ name: 'docs', version: '1.0.0' });
  server.tool('read', 'Reads a document', { id: z.string() }, async ({ id }) => ({
    content: [{ type: 'text', text: `document ${id}` }]
  }));
  server.tool('fail', 'Always fails', {}, async () => {
    throw new Error('lost connection to secret-host');
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

describe('guardTool', () => {
  it('passes the output through the toolResult hooks, with the tool name and source', async () => {
    const seen: unknown[] = [];
    const recorder: LoftMiddleware = {
      name: 'recorder',
      toolResult: (output, tool) => {
        seen.push(tool);
        return output;
      }
    };
    const tool = guardTool(
      additionalTool(async () => ({ content: [text('found it')] })),
      [upperResults, recorder]
    );

    await expect(tool.handler({}, { emit: () => undefined })).resolves.toEqual({
      content: [text('FOUND IT')],
      isError: false
    });
    expect(seen).toEqual([{ toolName: 'lookup', source: 'additional' }]);
  });

  it('rethrows an error with only the guarded message, without the original as its cause', async () => {
    const tool = guardTool(
      additionalTool(async () => {
        throw new Error('timeout talking to db');
      }),
      [upperResults]
    );

    const error = await tool.handler({}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('TIMEOUT TALKING TO DB');
    expect((error as Error).cause).toBeUndefined();
  });

  it('withholds the output when a hook fails', async () => {
    const tool = guardTool(
      additionalTool(async () => ({ content: [text('raw output')] })),
      [failing]
    );

    await expect(tool.handler({})).resolves.toEqual({ content: [text(TOOL_GUARD_FAILED_TEXT)], isError: true });
  });

  it('returns the tool itself when no middleware has a toolResult hook', () => {
    const tool = additionalTool(async () => ({ content: [] }));
    expect(guardTool(tool, [{ name: 'none' }])).toBe(tool);
  });
});

describe('guardMcpClient', () => {
  it('passes each tool result through the hooks and keeps every other method of the client', async () => {
    const client = await connectedClient();
    const seen: ToolOutput[] = [];
    const guarded = guardMcpClient(client, [
      upperResults,
      {
        name: 'recorder',
        toolResult: (output) => {
          seen.push(output);
          return output;
        }
      }
    ]);

    const result = await guarded.callTool({ name: 'read', arguments: { id: 'a1' } });

    expect(result.content).toEqual([{ type: 'text', text: 'DOCUMENT A1' }]);
    expect(seen).toEqual([{ content: [{ type: 'text', text: 'DOCUMENT A1' }], isError: false }]);
    expect(guarded.getServerVersion()).toEqual({ name: 'docs', version: '1.0.0' });
    await client.close();
  });

  it('guards the text of a tool error the server reports', async () => {
    const client = await connectedClient();
    const guarded = guardMcpClient(client, [
      {
        name: 'hide-host',
        toolResult: (output) => ({
          ...output,
          content: output.content.map((part) =>
            part.type === 'text' ? { ...part, text: part.text.replaceAll('secret-host', '[host]') } : part
          )
        })
      }
    ]);

    const result = await guarded.callTool({ name: 'fail', arguments: {} });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).not.toContain('secret-host');
    await client.close();
  });

  it('rethrows a failed call with only the guarded message', async () => {
    const client = await connectedClient();
    const callTool = vi.spyOn(client, 'callTool').mockRejectedValue(new Error('socket closed by secret-host'));
    const guarded = guardMcpClient(client, [upperResults]);

    await expect(guarded.callTool({ name: 'read', arguments: { id: 'a1' } })).rejects.toThrow(
      'SOCKET CLOSED BY SECRET-HOST'
    );
    expect(callTool).toHaveBeenCalledOnce();
    await client.close();
  });

  it('filters the tool list through the toolList hooks', async () => {
    const client = await connectedClient();
    const guarded = guardMcpClient(client, [
      { name: 'only-read', toolList: (tools) => tools.filter((tool) => tool.name === 'read') }
    ]);

    const { tools } = await guarded.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(['read']);
    await client.close();
  });

  it('returns the client itself when no middleware has a tool hook', async () => {
    const client = await connectedClient();
    expect(guardMcpClient(client, [{ name: 'none', maskTrace: (value) => value }])).toBe(client);
    await client.close();
  });
});

describe('applyMiddleware', () => {
  it('registers each chat hook under the middleware name, and tells whether afterGenerate changes the text', () => {
    const chat = {
      registerInputMiddleware: vi.fn(),
      registerBeforeGenerateMiddleware: vi.fn(),
      registerAfterGenerateMiddleware: vi.fn()
    };
    const hook = vi.fn();

    applyMiddleware(chat, [
      { name: 'first', input: hook, beforeGenerate: hook, afterGenerate: hook },
      { name: 'observer', afterGenerate: hook, afterGenerateTransformsOutput: false },
      { name: 'tools-only', toolResult: (output) => output }
    ]);

    expect(chat.registerInputMiddleware.mock.calls).toEqual([['first', hook]]);
    expect(chat.registerBeforeGenerateMiddleware.mock.calls).toEqual([['first', hook]]);
    expect(chat.registerAfterGenerateMiddleware.mock.calls).toEqual([
      ['first', hook, { transformsOutput: true }],
      ['observer', hook, { transformsOutput: false }]
    ]);
  });
});

describe('guardMcpClient edge cases (review findings)', () => {
  const structuredResult = { content: [{ type: 'text' as const, text: 'raw' }], structuredContent: { value: 'raw' } };

  it('drops the structured content of an output a guard changed, and keeps it otherwise', async () => {
    const client = await connectedClient();
    vi.spyOn(client, 'callTool').mockResolvedValue(structuredResult);

    const changed = await guardMcpClient(client, [upperResults]).callTool({ name: 'read', arguments: {} });
    const unchanged = await guardMcpClient(client, [{ name: 'same', toolResult: (output) => output }]).callTool({
      name: 'read',
      arguments: {}
    });

    expect(changed).not.toHaveProperty('structuredContent');
    expect(unchanged.structuredContent).toEqual({ value: 'raw' });
    await client.close();
  });

  it('leaves every tool out when a toolList hook fails', async () => {
    const client = await connectedClient();
    const guarded = guardMcpClient(client, [
      {
        name: 'failing',
        toolList: () => {
          throw new Error('detector down');
        }
      }
    ]);

    await expect(guarded.listTools()).resolves.toMatchObject({ tools: [] });
    await client.close();
  });
});

describe('installers (second review)', () => {
  const recorder = (seen: ToolInfo[]): LoftMiddleware => ({
    name: 'recorder',
    toolResult: (output, tool) => {
      seen.push(tool);
      return output;
    }
  });

  it('guardTools guards each tool', async () => {
    const tools = guardTools(
      [
        additionalTool(async () => ({ content: [text('one')] })),
        additionalTool(async () => ({ content: [text('two')] }))
      ],
      [upperResults]
    );

    await expect(Promise.all(tools.map((tool) => tool.handler({})))).resolves.toEqual([
      { content: [text('ONE')], isError: false },
      { content: [text('TWO')], isError: false }
    ]);
  });

  it('passes the server name given to guardMcpClient to the hooks', async () => {
    const client = await connectedClient();
    const seen: ToolInfo[] = [];

    await guardMcpClient(client, [recorder(seen)], { serverName: 'docs' }).callTool({
      name: 'read',
      arguments: { id: 'a1' }
    });

    expect(seen).toEqual([{ toolName: 'read', source: 'mcp', serverName: 'docs' }]);
    await client.close();
  });

  it('drops the output of an MCP result without a content list, which the hooks cannot check', async () => {
    const client = await connectedClient();
    vi.spyOn(client, 'callTool').mockResolvedValue({ toolResult: 'mail jane@example.com' });

    const result = await guardMcpClient(client, [upperResults]).callTool({ name: 'read', arguments: {} });

    // As LOFT reads only content, it treats the result as empty either way
    expect(result).toEqual({ content: [], isError: false });
    await client.close();
  });
});

describe('applyMiddleware trace check (second review)', () => {
  const mask: LoftMiddleware = { name: 'mask', maskTrace: (value) => value };
  const registrar = () => ({
    registerInputMiddleware: vi.fn(),
    registerBeforeGenerateMiddleware: vi.fn(),
    registerAfterGenerateMiddleware: vi.fn()
  });
  const chainSpy = () => ({ next: vi.fn() });
  const payload = { directMessages: [], augmentedContext: [] };
  const warnings = () => JSON.stringify(vi.mocked(logger.warn).mock.calls);

  // The Input hook applyMiddleware registers for the middleware, run with a context that has the given tracer
  const runInput = async (item: LoftMiddleware, tracer: object, times = 1) => {
    const chat = registrar();
    applyMiddleware(chat, [item]);
    const input = chat.registerInputMiddleware.mock.calls[0][1] as NonNullable<LoftMiddleware['input']>;
    for (let run = 0; run < times; run++) await input({ tracer } as never, payload, chainSpy() as never);
    return chat;
  };

  it('warns once when the chat tracer does not apply the mask', async () => {
    vi.mocked(logger.warn).mockClear();
    await runInput(mask, new RecordingTracerFactory().tracer(), 2);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(warnings()).toContain('maskTracerFactory');
  });

  it('does not warn when the tracer applies the mask, also through a tracer that wraps it', async () => {
    vi.mocked(logger.warn).mockClear();
    const masked = maskTracer(new RecordingTracerFactory().tracer(), [mask]);
    await runInput(mask, masked);
    await runInput(mask, maskTracer(masked, [{ name: 'other', maskTrace: (value) => value }]).withParent('p'));
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not warn for the tracer LOFT uses when none is given, as it sends nothing', async () => {
    vi.mocked(logger.warn).mockClear();
    class NoOpTracer {}
    await runInput(mask, new NoOpTracer());
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("runs the middleware's own Input hook after the check, and calls next itself when there is none", async () => {
    const input = vi.fn(async (_context: ContextInterface, value: GenerateRequestParameters) => value);
    const chat = registrar();
    applyMiddleware(chat, [
      { ...mask, input },
      { name: 'only-mask', maskTrace: (value) => value }
    ]);
    const [withInput, withoutInput] = chat.registerInputMiddleware.mock.calls.map(
      (call) => call[1] as NonNullable<LoftMiddleware['input']>
    );
    const tracer = maskTracer(new RecordingTracerFactory().tracer(), [mask]);
    const chain = chainSpy();

    await withInput({ tracer } as never, payload, chain as never);
    await withoutInput({ tracer } as never, payload, chain as never);

    expect(input).toHaveBeenCalledOnce();
    expect(chain.next).toHaveBeenCalledOnce();
  });
});
