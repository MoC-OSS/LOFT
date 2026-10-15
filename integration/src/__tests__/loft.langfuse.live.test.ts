import 'reflect-metadata';

import { FsRepositoryConstructor, LangfuseTracer, LoftConstructor, ManifestManagerConstructor } from '@moc-global/loft';
import { Interface, Type } from '@moc-global/loft-definitions';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { env, hasKeys, requireKey } from './config';
import { initDB, type TestDatabaseInstance } from './initDB';
import { createChatConstructor } from './loftInit';
import { EchoLLMStrategy } from './mocks/EchoLLMStrategy';

const TEST_TIMEOUT = 30000;

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

function createLoftConstructorWithLangfuse(chatConstructor: any, langfuseTracer: LangfuseTracer): LoftConstructor<any> {
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
    langfuseTracer
  );
}

// Live: sends traces to the Langfuse instance in .env.test
describe.runIf(hasKeys('LANGFUSE_SECRET_KEY', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_HOST'))(
  'LOFT Langfuse Integration Tests',
  () => {
    let testDb: TestDatabaseInstance;
    let langfuseTracer: LangfuseTracer;

    beforeAll(async () => {
      testDb = await initDB();

      // Initialize Langfuse tracer with local instance
      langfuseTracer = new LangfuseTracer({
        secretKey: requireKey('LANGFUSE_SECRET_KEY'),
        publicKey: requireKey('LANGFUSE_PUBLIC_KEY'),
        baseUrl: requireKey('LANGFUSE_HOST')
      });
    }, TEST_TIMEOUT);

    afterAll(async () => {
      try {
        if (langfuseTracer) {
          await langfuseTracer.shutdownAsync();
        }
      } catch (error) {
        console.error('Error shutting down Langfuse tracer:', error);
      }
      try {
        if (testDb) {
          await testDb.close();
        }
      } catch (error) {
        console.error('Error closing test database:', error);
      }
    }, TEST_TIMEOUT);

    beforeEach(async () => {
      await testDb.truncateAll();
    });

    it(
      'should create and track traces with real Langfuse instance',
      async () => {
        const chatConstructor = createChatConstructor(testDb);
        const loftConstructor = createLoftConstructorWithLangfuse(chatConstructor, langfuseTracer);
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
            sessionId: 'langfuse-test-session'
          }
        });

        // First message
        const result1 = await loft.chat.generate({
          sessionId: session.id,
          directMessages: [createTestMessage('Hello, this is a test message for Langfuse tracing!', session.id)]
        });

        expect(result1).toBeDefined();
        expect(result1.messages.llmResponse.topChoice.content[0].text).toContain(
          'Hello, this is a test message for Langfuse tracing!'
        );

        // Second message
        const result2 = await loft.chat.generate({
          sessionId: session.id,
          directMessages: [
            createTestMessage('Hello, this is a test message for Langfuse tracing!', session.id),
            createTestMessage('This is a follow-up message to test trace continuation.', session.id)
          ]
        });

        expect(result2).toBeDefined();
        expect(result2.messages.llmResponse.topChoice.content[0].text).toContain(
          'This is a follow-up message to test trace continuation.'
        );

        // Third message
        const result3 = await loft.chat.generate({
          sessionId: session.id,
          directMessages: [
            createTestMessage('Hello, this is a test message for Langfuse tracing!', session.id),
            createTestMessage('This is a follow-up message to test trace continuation.', session.id),
            createTestMessage('Final test message to complete the conversation trace.', session.id)
          ]
        });

        expect(result3).toBeDefined();
        expect(result3.messages.llmResponse.topChoice.content[0].text).toContain(
          'Final test message to complete the conversation trace.'
        );

        console.log(`✅ Langfuse test completed successfully for session: ${session.id}`);
        console.log('🌐 Check traces at: http://localhost:3000');
      },
      TEST_TIMEOUT
    );

    it(
      'should verify tracer is available in context through middleware',
      async () => {
        const chatConstructor = createChatConstructor(testDb);
        const loftConstructor = createLoftConstructorWithLangfuse(chatConstructor, langfuseTracer);
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
            sessionId: 'langfuse-tracer-test-session'
          }
        });

        // Generate to trigger context creation
        await loft.chat.generate({
          sessionId: session.id,
          directMessages: [createTestMessage('Test message to initialize context', session.id)]
        });

        // Get the context and verify tracer is available
        const context = await loft.chat.contextProvider.get(session.id);

        expect(context.tracer).toBeDefined();
        expect(typeof context.tracer.span).toBe('function');
        expect(typeof context.tracer.generation).toBe('function');
        expect(typeof context.tracer.event).toBe('function');

        // Test custom span creation
        const span = context.tracer.span({
          name: 'custom-test-span',
          input: { test: 'data' }
        });

        expect(span).toBeDefined();
        expect(typeof span.end).toBe('function');

        span.end({ output: { result: 'success' } });

        await context.tracer.flushAsync();
      },
      TEST_TIMEOUT
    );
  }
);
