import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDB, type TestDatabaseInstance } from './initDB';
import { InitClientServer } from './mcpClientServerInMemory';
import { MockTracerStrategy, TracerEvent } from './mocks/MockTracerStrategy';
import { SCRIPTED_LLM, startScriptedChat, userMessage } from './scriptedChat';

describe('Nested tracing of the tool loop', () => {
  let testDb: TestDatabaseInstance;

  beforeAll(async () => {
    testDb = await initDB();
  });

  afterAll(async () => {
    await testDb?.close();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
  });

  it('nests each model call under the previous one and each tool span under its model call', async () => {
    const tracer = new MockTracerStrategy();
    const { loft, session } = await startScriptedChat(
      testDb,
      [
        {
          toolCalls: [
            { name: 'add', arguments: { a: 20, b: 10 } },
            { name: 'subtract', arguments: { a: 100, b: 25 } }
          ]
        },
        { toolCalls: [{ name: 'multiply', arguments: { a: 30, b: 3 } }] },
        { text: '90 and 75' }
      ],
      {
        tracer,
        mcpClients: { calculator: await InitClientServer() },
        configure: ({ chatConstructor }) =>
          chatConstructor.registerInputMiddleware('traced-step', async (ctx, payload, chain) => {
            const span = ctx.tracer.span({ name: 'test/input-middleware', input: payload });
            chain.next();
            span.end({ output: payload });
            return payload;
          })
      }
    );

    await loft.chat.generate({ sessionId: session.id, directMessages: [userMessage('Calculate', session.id)] });

    // One trace per generate(), flushed once
    expect(tracer.createTracerCalls).toBe(1);
    expect(tracer.events.find((event) => event.type === 'createTracer')?.data.name).toBe(`loft-generate-${session.id}`);
    expect(tracer.flushAsyncCalls).toBe(1);

    const started = (type: TracerEvent['type']) => tracer.events.filter((event) => event.type === type);
    const generations = started('generation');
    const name = (event: TracerEvent): string => event.data.name;

    // The model calls sit under the LLM operation span of this generate()
    const llmOperation = started('span').find((event) => name(event) === `llm-operation/test-bot/${SCRIPTED_LLM}`);
    expect(llmOperation).toBeDefined();

    // Three model calls; from the second on, each is a child of the one before
    expect(generations.map(name)).toEqual([
      `test-bot/${SCRIPTED_LLM}:scripted-model#1`,
      `test-bot/${SCRIPTED_LLM}:scripted-model#2`,
      `test-bot/${SCRIPTED_LLM}:scripted-model#3`
    ]);
    expect(generations.map((event) => event.parentId)).toEqual([
      llmOperation!.spanId,
      generations[0].spanId,
      generations[1].spanId
    ]);

    // Each tool span is a child of the model call that asked for the tool
    const toolSpans = started('span').filter((event) => name(event).startsWith('mcp-tool-'));
    expect(toolSpans.map((event) => [name(event), event.parentId])).toEqual([
      ['mcp-tool-add', generations[0].spanId],
      ['mcp-tool-subtract', generations[0].spanId],
      ['mcp-tool-multiply', generations[1].spanId]
    ]);

    // Spans opened by middleware land in the same trace
    expect(started('span').some((event) => name(event) === 'test/input-middleware')).toBe(true);
    expect(new Set(tracer.events.filter((event) => event.traceId).map((event) => event.traceId)).size).toBe(1);

    // Every span and generation is ended, the generations with the model's usage
    const ended = new Set(
      tracer.events.filter((event) => event.type === 'spanEnd' || event.type === 'generationEnd').map((e) => e.spanId)
    );
    for (const event of [...generations, ...toolSpans]) expect(ended.has(event.spanId)).toBe(true);
    const generationEnds = started('generationEnd');
    expect(generationEnds.map((event) => event.data.usage)).toEqual(
      Array.from({ length: 3 }, () => ({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }))
    );
  });
});
