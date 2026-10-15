import 'reflect-metadata';

import { LoftConstructor } from '@moc-global/loft';
import { FsRepositoryConstructor, ManifestManagerConstructor } from '@moc-global/loft';
import { Interface, Strategy, Type } from '@moc-global/loft-definitions';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { env } from './config';
import { initDB, type TestDatabaseInstance } from './initDB';
import { createChatConstructor } from './loftInit';
import { EchoLLMStrategy } from './mocks/EchoLLMStrategy';
import { MockTracerStrategy } from './mocks/MockTracerStrategy';

// Helper function to create test messages
function createTestMessage(text: string, sessionId: string): Type.Entity.CreateMessage {
  return {
    id: uuidv4(),
    sessionId,
    ctx: {},
    llmName: 'gpt-4o-mini',
    manifestName: 'test-bot',
    content: [{ type: 'text', text }],
    role: Type.LLM.UnifiedMessageRole.user,
    author: 'user',
    llmIgnore: false
  };
}

function createLoftConstructorWithTracer(
  chatConstructor: any,
  tracerStrategy: Strategy.Tracer.TracerFactory
): LoftConstructor<any> {
  const manifestRepository = new FsRepositoryConstructor();
  const manifestManagerConstructor = new ManifestManagerConstructor(manifestRepository, {
    manifestPath: env.LOFT_MANIFEST_PATH,
    errorPath: env.LOFT_MANIFEST_ERROR_PATH,
    cacheExpirationTime: env.LOFT_MANIFEST_CACHE_EXPIRATION
  });

  return new LoftConstructor(
    { logLevel: Interface.LogLevel.TRACE },
    manifestManagerConstructor,
    chatConstructor,
    tracerStrategy
  );
}

describe('Loft Tracer Integration Tests', () => {
  let testDb: TestDatabaseInstance;
  let mockTracer: MockTracerStrategy;

  beforeEach(async () => {
    mockTracer = new MockTracerStrategy();
    await testDb.truncateAll();
  });

  beforeAll(async () => {
    testDb = await initDB();
  });

  afterAll(async () => {
    try {
      if (testDb) {
        await testDb.close();
      }
    } catch (error) {
      console.error('Error closing test database:', error);
    }
  });

  it('should create tracer on context creation', async () => {
    const chatConstructor = createChatConstructor(testDb);
    const loftConstructor = createLoftConstructorWithTracer(chatConstructor, mockTracer);
    const loft = loftConstructor.getInstance();

    // Register Echo LLM strategy
    await loftConstructor.registerLlmStrategy('gpt-4o-mini', new EchoLLMStrategy('gpt-4o-mini'));

    // Create a session
    const session = await loft.chat.createSession({
      currentLlmName: 'gpt-4o-mini',
      currentManifestName: 'test-bot',
      ctx: {},
      externalKey: {
        userId: 'test-user',
        sessionId: 'test-session'
      }
    });

    // Generate to trigger context creation
    const result = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [createTestMessage('Hello', session.id)]
    });

    // Verify tracer was created
    expect(mockTracer.createTracerCalls).toBe(1);

    // Verify createTracer was called with correct parameters
    const createTracerEvent = mockTracer.events.find((e) => e.type === 'createTracer');
    expect(createTracerEvent).toBeDefined();
    expect(createTracerEvent?.data).toMatchObject({
      name: expect.stringContaining('loft-generate'),
      sessionId: session.id
    });

    // Verify tracer is available in context
    expect(result.ctx.tracer).toBeDefined();
  });

  it('should trace LLM generation with metadata', async () => {
    const chatConstructor = createChatConstructor(testDb);
    const loftConstructor = createLoftConstructorWithTracer(chatConstructor, mockTracer);
    const loft = loftConstructor.getInstance();

    // Register Echo LLM strategy
    await loftConstructor.registerLlmStrategy('gpt-4o-mini', new EchoLLMStrategy('gpt-4o-mini'));

    // Create a session
    const session = await loft.chat.createSession({
      currentLlmName: 'gpt-4o-mini',
      currentManifestName: 'test-bot',
      ctx: {}
    });

    // Generate to trigger LLM call
    await loft.chat.generate({
      sessionId: session.id,
      directMessages: [createTestMessage('Test message', session.id)]
    });

    // Find generation events
    const generationEvents = mockTracer.events.filter((e) => e.type === 'generation');
    expect(generationEvents.length).toBeGreaterThan(0);

    // Verify generation metadata
    const generationEvent = generationEvents[0];
    expect(generationEvent.data).toMatchObject({
      name: 'test-bot/gpt-4o-mini:gpt-4o-mini#1',
      metadata: {
        llmName: 'gpt-4o-mini',
        manifestName: 'test-bot'
      }
    });

    // Verify generation end event
    const generationEndEvents = mockTracer.events.filter((e) => e.type === 'generationEnd');
    expect(generationEndEvents.length).toBeGreaterThan(0);

    const generationEndEvent = generationEndEvents[0];
    expect(generationEndEvent.data).toMatchObject({
      level: 'DEFAULT',
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30
      }
    });
  });

  it('should flush traces on generate completion', async () => {
    const chatConstructor = createChatConstructor(testDb);
    const loftConstructor = createLoftConstructorWithTracer(chatConstructor, mockTracer);
    const loft = loftConstructor.getInstance();

    // Register Echo LLM strategy
    await loftConstructor.registerLlmStrategy('gpt-4o-mini', new EchoLLMStrategy('gpt-4o-mini'));

    // Create a session
    const session = await loft.chat.createSession({
      currentLlmName: 'gpt-4o-mini',
      currentManifestName: 'test-bot',
      ctx: {}
    });

    // Reset to track fresh
    mockTracer.reset();

    // Generate
    await loft.chat.generate({
      sessionId: session.id,
      directMessages: [createTestMessage('Test message', session.id)]
    });

    // Verify flushAsync was called
    expect(mockTracer.flushAsyncCalls).toBe(1);

    // Verify flush event exists
    const flushEvents = mockTracer.events.filter((e) => e.type === 'flushAsync');
    expect(flushEvents).toHaveLength(1);
  });

  it('should handle nested spans', async () => {
    const chatConstructor = createChatConstructor(testDb);
    const loftConstructor = createLoftConstructorWithTracer(chatConstructor, mockTracer);
    const loft = loftConstructor.getInstance();

    // Register Echo LLM strategy
    await loftConstructor.registerLlmStrategy('gpt-4o-mini', new EchoLLMStrategy('gpt-4o-mini'));

    // Create a session
    const session = await loft.chat.createSession({
      currentLlmName: 'gpt-4o-mini',
      currentManifestName: 'test-bot',
      ctx: {}
    });

    // Generate to get context
    const result = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [createTestMessage('Test', session.id)]
    });

    // Simulate nested span usage
    const parentSpan = (result.ctx.tracer as any).span({ name: 'parent-operation' });
    const childSpan = parentSpan.span({ name: 'child-operation' });

    childSpan.end({ output: 'child-result' });
    parentSpan.end({ output: 'parent-result' });

    // Verify span hierarchy
    const spanEvents = mockTracer.events.filter((e) => e.type === 'span');
    const parentSpanEvent = spanEvents.find((e) => e.data?.name === 'parent-operation');
    const childSpanEvent = spanEvents.find((e) => e.data?.name === 'child-operation');

    expect(parentSpanEvent).toBeDefined();
    expect(childSpanEvent).toBeDefined();
    expect(childSpanEvent?.data?.parentSpanId).toBeDefined();
  });

  it('should handle graceful shutdown', async () => {
    const chatConstructor = createChatConstructor(testDb);
    const loftConstructor = createLoftConstructorWithTracer(chatConstructor, mockTracer);
    const loft = loftConstructor.getInstance();

    // Register Echo LLM strategy
    await loftConstructor.registerLlmStrategy('gpt-4o-mini', new EchoLLMStrategy('gpt-4o-mini'));

    // Create a session and generate
    const session = await loft.chat.createSession({
      currentLlmName: 'gpt-4o-mini',
      currentManifestName: 'test-bot',
      ctx: {}
    });

    await loft.chat.generate({
      sessionId: session.id,
      directMessages: [createTestMessage('Test', session.id)]
    });

    // Call graceful shutdown
    await loftConstructor.gracefulShutdown();

    // Verify shutdownAsync was called
    expect(mockTracer.shutdownAsyncCalls).toBe(1);

    // Verify shutdown event
    const shutdownEvents = mockTracer.events.filter((e) => e.type === 'shutdownAsync');
    expect(shutdownEvents).toHaveLength(1);
  });

  it('should flush traces even on error during generation', async () => {
    const chatConstructor = createChatConstructor(testDb);
    const loftConstructor = createLoftConstructorWithTracer(chatConstructor, mockTracer);
    const loft = loftConstructor.getInstance();

    // Create a failing LLM strategy
    class FailingLlmStrategy extends EchoLLMStrategy {
      async generate(): Promise<any> {
        throw new Error('Simulated LLM error');
      }
    }

    // Register failing LLM strategy
    await loftConstructor.registerLlmStrategy('gpt-4o-mini', new FailingLlmStrategy('gpt-4o-mini'));

    // Create a session
    const session = await loft.chat.createSession({
      currentLlmName: 'gpt-4o-mini',
      currentManifestName: 'test-bot',
      ctx: {}
    });

    // Reset to track fresh
    mockTracer.reset();

    // Try to generate (should fail)
    try {
      await loft.chat.generate({
        sessionId: session.id,
        directMessages: [createTestMessage('Test', session.id)]
      });
    } catch (error) {
      // Expected error
    }

    // Verify flushAsync was still called
    expect(mockTracer.flushAsyncCalls).toBe(1);

    // Verify generation end event has error status
    const generationEndEvents = mockTracer.events.filter((e) => e.type === 'generationEnd');
    expect(generationEndEvents.length).toBeGreaterThan(0);
    expect(generationEndEvents[0].data?.level).toBe('ERROR');
  });

  it('should track multiple traces for multiple contexts', async () => {
    const chatConstructor = createChatConstructor(testDb);
    const loftConstructor = createLoftConstructorWithTracer(chatConstructor, mockTracer);

    // Register Echo LLM strategy BEFORE getting instance
    await loftConstructor.registerLlmStrategy('gpt-4o-mini', new EchoLLMStrategy('gpt-4o-mini'));

    const loft = loftConstructor.getInstance();

    // Create two sessions
    const session1 = await loft.chat.createSession({
      currentLlmName: 'gpt-4o-mini',
      currentManifestName: 'test-bot',
      ctx: {}
    });

    const session2 = await loft.chat.createSession({
      currentLlmName: 'gpt-4o-mini',
      currentManifestName: 'test-bot',
      ctx: {}
    });

    // Reset to track fresh
    mockTracer.reset();

    // Generate for both sessions in parallel
    console.log('Starting parallel generation for both sessions...');

    await Promise.all([
      loft.chat
        .generate({
          sessionId: session1.id,
          directMessages: [createTestMessage('Session 1', session1.id)]
        })
        .then(() => console.log('Session 1 completed')),
      loft.chat
        .generate({
          sessionId: session2.id,
          directMessages: [createTestMessage('Session 2', session2.id)]
        })
        .then(() => console.log('Session 2 completed'))
    ]);

    console.log('Both sessions completed');

    // Verify two separate traces were created
    expect(mockTracer.createTracerCalls).toBe(2);

    // Verify each trace has its own ID
    const createEvents = mockTracer.events.filter((e) => e.type === 'createTracer');
    expect(createEvents).toHaveLength(2);

    const traceIds = createEvents.map((e) => e.traceId);
    expect(new Set(traceIds).size).toBe(2); // Should be 2 unique trace IDs

    // Verify both were flushed
    expect(mockTracer.flushAsyncCalls).toBe(2);
  });

  it('should verify tracer is available in context through middleware', async () => {
    const chatConstructor = createChatConstructor(testDb);
    const loftConstructor = createLoftConstructorWithTracer(chatConstructor, mockTracer);
    await loftConstructor.registerLlmStrategy('gpt-4o-mini', new EchoLLMStrategy('gpt-4o-mini'));
    const loft = loftConstructor.getInstance();

    let contextTracer: any = null;

    // Add middleware to capture the tracer from context
    chatConstructor.registerBeforeGenerateMiddleware('capture-tracer-middleware', async (ctx, payload, chain) => {
      contextTracer = ctx.tracer;
      await chain.next();
      return payload;
    });

    // Create a session
    const session = await loft.chat.createSession({
      currentLlmName: 'gpt-4o-mini',
      currentManifestName: 'test-bot',
      ctx: {}
    });

    // Generate to trigger context creation and middleware
    await loft.chat.generate({
      sessionId: session.id,
      directMessages: [createTestMessage('Test tracer access', session.id)]
    });

    // Verify tracer was accessible in middleware context
    expect(contextTracer).toBeDefined();
    expect(typeof contextTracer.span).toBe('function');
    expect(typeof contextTracer.generation).toBe('function');
    expect(typeof contextTracer.flushAsync).toBe('function');
  });
});
