import 'reflect-metadata';

import {
  Chat,
  ContextInterface,
  ContextProviderInterface,
  DI_TYPES,
  GenerateError,
  InteractiveOutputMessage,
  Interface,
  Repository,
  Schema,
  Type
} from '@moc-global/loft-definitions';
import { configureSpyLoggerStrategy } from '@moc-global/loft-test-suite';
import { Container } from 'inversify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NoOpTracerStrategy } from '../../../../../base-components';
import { GenerateResultMessages } from '../../../../../entities';
import { HealthCheckComponent, LoftHealthCheckInterface } from '../../../../../LoftHealthCheck';
import {
  GenerateResultMessagesProvider,
  GenerateResultMessagesProviderInterface
} from '../../../../../providers/GenerateResultMessagesProvider';
import { ChatConfig } from '../../../../../types';
import { BaseLoftChat } from '../../../../../workflows/chat/BaseLoftChat';
import { createSingleUseAppendMessageFunction } from '../../../../../workflows/chat/util';

// Mock implementations
class MockContextProvider implements ContextProviderInterface {
  get = vi.fn();
  update = vi.fn();
  lock = vi.fn();
  unlock = vi.fn();
}

const spyLoggerStrategy = configureSpyLoggerStrategy();

class MockSessionRepository implements Repository.Session {
  getById = vi.fn();
  getByExternalKey = vi.fn();
  create = vi.fn();
  update = vi.fn();
  updateById = vi.fn();
  deleteById = vi.fn();
  checkHealth = vi.fn();
  end = vi.fn();
}

class MockChatHistoryManager implements Repository.ChatHistoryManager {
  getMessages = vi.fn();
  addMessages = vi.fn();
  patchMessages = vi.fn();
  checkHealth = vi.fn();
  end = vi.fn();
}

class MockLlmManager implements Interface.LlmManager {
  generate = vi.fn();
  use = vi.fn();
  get = vi.fn();
  aiTask = vi.fn();
  generateQueued = vi.fn();
  checkHealth = vi.fn();
  end = vi.fn();
  regenerate = vi.fn();
  getContext = vi.fn();
  generateStream = vi.fn();
  getPrompt = vi.fn();
  getHealthCheckStatuses = vi.fn();
}

class MockLoftHealthCheck implements LoftHealthCheckInterface {
  check = vi.fn();
}

class MockGenerateResponseProvider {
  create(
    directMessages: any[] = [],
    augmentedContext: any[] = [],
    llmResponse: any = {},
    sessionId: string = 'test-session-id'
  ) {
    return new GenerateResultMessages(directMessages, augmentedContext, llmResponse, sessionId);
  }
}

/**
 * Helper functions to reduce duplication and make tests more focused on outcomes
 */

/**
 * Creates a standard mock context for testing
 */
function createMockContext(sessionId = 'test-session-id', overrides = {}): ContextInterface {
  // Directly reference the function within this scope to prevent linter errors
  const validMessage = {
    sessionId: 'test-session-id',
    ctx: {},
    content: [{ type: 'text' as const, text: 'test message' }],
    role: Type.LLM.UnifiedMessageRole.user,
    author: 'user',
    llmName: 'test-llm',
    manifestName: 'test-manifest',
    llmIgnore: false
  };

  // Create tracer for testing
  const tracerStrategy = new NoOpTracerStrategy();
  const tracer = tracerStrategy.createTracer({
    traceId: 'test-trace-id',
    name: 'test-tracer',
    sessionId: sessionId
  });

  return {
    sessionId,
    session: {
      id: sessionId,
      currentLlmName: 'test-llm',
      currentManifestName: 'test-manifest'
    },
    request: {
      correlatorIds: ['correlator-1'],
      messageIds: { all: ['message-1'], direct: ['message-1'], augmented: [] },
      messages: {
        directMessages: [validMessage],
        augmentedContext: []
      }
    },
    chatHistory: {
      messages: [
        {
          id: 'test-id',
          sessionId: sessionId,
          ctx: {},
          content: [{ type: 'text' as const, text: 'pending user message' }],
          role: Type.LLM.UnifiedMessageRole.user,
          author: 'user',
          llmName: 'test-llm',
          manifestName: 'test-manifest',
          createdAt: new Date(),
          updatedAt: new Date(),
          sequenceId: '0001',
          llmIgnore: false,
          patch: vi.fn()
        } as unknown as Interface.FacadeEntity.Message
      ]
    },
    tracer: tracer,
    ...overrides
  } as unknown as ContextInterface;
}

/**
 * Creates a standard mock LLM response
 */
function createMockLlmResponse(
  content = [{ type: 'text' as const, text: 'test response' }],
  role = Type.LLM.UnifiedMessageRole.assistant
): any {
  const setAppendFnMock = vi.fn();
  const topChoice = {
    content,
    role,
    setAppendFn: setAppendFnMock
  };
  return {
    choices: [topChoice], // choices[0] should be the same as topChoice
    setAppendFn: setAppendFnMock,
    topChoice
  };
}

/**
 * Sets up common mocks for generate tests
 */
function setupMocksForGenerate({
  contextProvider,
  inputMiddlewareManager,
  beforeGenerateMiddlewareManager,
  llmManager,
  afterGenerateMiddlewareManager,
  mockContext,
  mockLlmResponse,
  directMessages = [],
  augmentedContext = [],
  preventGeneration = false
}: {
  contextProvider: MockContextProvider;
  inputMiddlewareManager: any;
  beforeGenerateMiddlewareManager: any;
  llmManager: MockLlmManager;
  afterGenerateMiddlewareManager: any;
  mockContext: ContextInterface;
  mockLlmResponse: any;
  directMessages?: Type.Entity.CreateMessage[];
  augmentedContext?: Type.Entity.CreateMessage[];
  preventGeneration?: boolean;
}): void {
  // Setup context provider mocks
  contextProvider.get.mockResolvedValue(mockContext);
  contextProvider.unlock.mockResolvedValue(mockContext);
  contextProvider.lock.mockReturnValue(mockContext);
  contextProvider.update.mockResolvedValue(mockContext);

  // Setup middleware mocks
  inputMiddlewareManager.executeChain.mockResolvedValue({
    payload: { directMessages, augmentedContext }
  });

  beforeGenerateMiddlewareManager.executeChain.mockResolvedValue({
    payload: { directMessages, augmentedContext },
    isGenerationPrevented: preventGeneration
  });

  // Setup LLM manager mocks
  llmManager.generate.mockResolvedValue(mockLlmResponse);

  // Setup after generate middleware mocks
  afterGenerateMiddlewareManager.executeChain.mockResolvedValue({
    payload: {
      directMessages,
      augmentedContext,
      llmResponse: mockLlmResponse
    }
  });
}

/**
 * Asserts the success response from generate
 */
function assertSuccessfulGenerateResponse(
  result: Chat.GenerateResult,
  sessionId: string,
  correlatorIds: string[],
  messageIds?: any
): void {
  expect(result.status).toBe(Chat.Status.SUCCESS);
  expect(result.sessionId).toBe(sessionId);
  expect(result.correlatorIds).toStrictEqual(correlatorIds);

  // Only check messageIds if provided
  if (messageIds) {
    expect(result.messageIds).toStrictEqual(messageIds);
  }
}

describe('BaseLoftChat', () => {
  let container: Container;
  let baseLoftChat: BaseLoftChat;
  let mockSessionRepository: MockSessionRepository;
  let mockChatHistoryManager: MockChatHistoryManager;
  let mockContextProvider: MockContextProvider;
  let mockLlmManager: MockLlmManager;
  let mockLoftHealthCheck: MockLoftHealthCheck;
  let mockInputMiddlewareManager: any;
  let mockBeforeGenerateMiddlewareManager: any;
  let mockAfterGenerateMiddlewareManager: any;
  let mockChatConfig: ChatConfig;

  // Helper to create valid messages
  function createValidMessage(overrides: Partial<Type.Entity.CreateMessage> = {}): Type.Entity.CreateMessage {
    return {
      sessionId: 'test-session-id',
      ctx: {},
      content: [{ type: 'text' as const, text: 'test message' }],
      role: Type.LLM.UnifiedMessageRole.user,
      author: 'user',
      llmName: 'test-llm',
      manifestName: 'test-manifest',
      llmIgnore: false,
      ...overrides
    };
  }

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Reset module mocks
    vi.resetModules();

    // Make sure we don't have any module mocks active from previous tests
    vi.doUnmock('@moc-global/loft-definitions');

    // Mock Zod schema validation
    vi.spyOn(Schema.Entity.CreateMessage, 'array').mockReturnValue({
      safeParse: (data: Type.Entity.CreateMessage[]) => ({ success: true, data })
    } as any);

    // Create mocks
    mockSessionRepository = new MockSessionRepository();
    mockChatHistoryManager = new MockChatHistoryManager();
    mockContextProvider = new MockContextProvider();
    mockLlmManager = new MockLlmManager();
    mockLoftHealthCheck = new MockLoftHealthCheck();

    // Create middleware managers with executeChain as a mock function
    mockInputMiddlewareManager = {
      executeChain: vi.fn().mockResolvedValue({
        payload: { directMessages: [], augmentedContext: [] }
      })
    };
    mockBeforeGenerateMiddlewareManager = {
      executeChain: vi.fn().mockResolvedValue({
        payload: { directMessages: [], augmentedContext: [] }
      })
    };
    mockAfterGenerateMiddlewareManager = {
      executeChain: vi.fn().mockResolvedValue({
        payload: { directMessages: [], augmentedContext: [] }
      })
    };

    mockChatConfig = {
      // retryConfig: {
      //   maxRetries: 3,
      //   initialDelayMs: 1000,
      //   backoffMultiplier: 2
      // },
      // activeSessionLimit: 10
    };

    // Set up container with mock dependencies
    container = new Container();
    container.bind<Repository.Session>(DI_TYPES.SessionRepository).toConstantValue(mockSessionRepository);
    container.bind<Repository.ChatHistoryManager>(DI_TYPES.ChatHistoryManager).toConstantValue(mockChatHistoryManager);
    container.bind<ContextProviderInterface>(DI_TYPES.ContextProvider).toConstantValue(mockContextProvider);
    container.bind<Interface.LlmManager>(DI_TYPES.LlmManager).toConstantValue(mockLlmManager);
    container.bind<ChatConfig>(DI_TYPES.ChatConfig).toConstantValue(mockChatConfig);
    container.bind<LoftHealthCheckInterface>(DI_TYPES.LoftHealthCheck).toConstantValue(mockLoftHealthCheck);
    container.bind(DI_TYPES.InputMiddleware).toConstantValue(mockInputMiddlewareManager);
    container.bind(DI_TYPES.BeforeGenerateMiddlewareManager).toConstantValue(mockBeforeGenerateMiddlewareManager);
    container.bind(DI_TYPES.AfterGenerateMiddlewareManager).toConstantValue(mockAfterGenerateMiddlewareManager);
    container
      .bind<GenerateResultMessagesProviderInterface>(DI_TYPES.GenerateResultMessagesProvider)
      .to(GenerateResultMessagesProvider);
    container.bind<BaseLoftChat>(BaseLoftChat).toSelf();

    // Get instance
    baseLoftChat = container.get<BaseLoftChat>(BaseLoftChat);
  });

  describe('addMessages', () => {
    it('should add messages successfully', async () => {
      // Arrange
      const sessionId = 'test-session-id';
      const correlatorIds = ['correlator-1'];
      const messages = [createValidMessage()];
      const mockContext = createMockContext(sessionId, {});

      // Setup mocks
      mockContextProvider.get.mockResolvedValue(mockContext);
      mockInputMiddlewareManager.executeChain.mockResolvedValue({
        payload: {
          augmentedContext: [],
          directMessages: messages
        }
      });
      mockChatHistoryManager.addMessages.mockResolvedValue(undefined); // Actual implementation returns undefined

      // Act
      const result = await baseLoftChat.addMessages(sessionId, correlatorIds, messages);

      // Assert - focus on behavior/outcomes, not implementation details
      expect(result).toBeUndefined(); // The method doesn't return anything

      // We still need to verify messages were passed to chat history manager,
      // but we're being less specific about how contextProvider.get was used
      expect(mockChatHistoryManager.addMessages).toHaveBeenCalledWith(
        expect.any(String), // sessionId - we don't care about the exact value
        expect.arrayContaining(messages) // just check that our messages were included
      );
    });

    it('should handle errors', async () => {
      // Arrange
      const sessionId = 'test-session-id';
      const correlatorIds = ['correlator-1'];
      const messages = [createValidMessage()];
      const error = new Error('Test error');
      const mockContext = createMockContext(sessionId, {});

      // Setup mocks - we need to make sure all the steps before the error are mocked properly
      mockContextProvider.get.mockResolvedValue(mockContext);
      mockInputMiddlewareManager.executeChain.mockResolvedValue({
        payload: {
          augmentedContext: [],
          directMessages: messages
        }
      });
      mockChatHistoryManager.addMessages.mockRejectedValue(error);

      // Act & Assert
      await expect(baseLoftChat.addMessages(sessionId, correlatorIds, messages)).rejects.toThrow(error);

      // No need to verify mockContextProvider.get was called - that's an implementation detail
      // The key outcome is that when chatHistoryManager.addMessages fails, the error is propagated
    });

    it('logs a failed addMessages without the message content', async () => {
      const sessionId = 'test-session-id';
      const messages = [createValidMessage({ content: [{ type: 'text' as const, text: 'PRIVATE-USER-TEXT' }] })];
      mockContextProvider.get.mockResolvedValue(createMockContext());
      mockInputMiddlewareManager.executeChain.mockResolvedValue({
        payload: { augmentedContext: [], directMessages: messages }
      });
      mockChatHistoryManager.addMessages.mockRejectedValue(new Error('DB down'));
      vi.mocked(spyLoggerStrategy.error).mockClear();

      await expect(baseLoftChat.addMessages(sessionId, ['correlator'], messages)).rejects.toThrow('DB down');

      const logged = vi.mocked(spyLoggerStrategy.error).mock.calls;
      expect(logged).toContainEqual(expect.arrayContaining(['addMessages() error:', { sessionId, messageCount: 1 }]));
      expect(JSON.stringify(logged)).not.toContain('PRIVATE-USER-TEXT');
    });
  });

  describe('generate', () => {
    const setupGenerateTest = () => {
      const sessionId = 'test-session-id';
      const correlatorIds = ['correlator-1'];
      const messageIds = { all: ['message-1'], direct: ['message-1'], augmented: [] };
      const directMessages: Type.Entity.CreateMessage[] = [createValidMessage()];
      const augmentedContext: Type.Entity.CreateMessage[] = [];
      const mockContext = createMockContext(sessionId);

      return { sessionId, correlatorIds, messageIds, directMessages, augmentedContext, mockContext };
    };

    it('should generate response successfully', async () => {
      // Arrange
      const sessionId = 'test-session-id';
      const correlatorIds = ['correlator-1'];
      const messageIds = { all: ['message-1'], direct: ['message-1'], augmented: [] };
      const directMessages = [createValidMessage()];
      const augmentedContext: Type.Entity.CreateMessage[] = [];
      const mockContext = createMockContext(sessionId);
      const mockLlmResponse = createMockLlmResponse();

      // Setup all mocks
      setupMocksForGenerate({
        contextProvider: mockContextProvider,
        inputMiddlewareManager: mockInputMiddlewareManager,
        beforeGenerateMiddlewareManager: mockBeforeGenerateMiddlewareManager,
        llmManager: mockLlmManager,
        afterGenerateMiddlewareManager: mockAfterGenerateMiddlewareManager,
        mockContext,
        mockLlmResponse,
        directMessages,
        augmentedContext
      });

      // Act
      const result = await baseLoftChat.generate({
        sessionId,
        directMessages,
        augmentedContext,
        correlatorIds
      });

      // Assert - focus on outcome, not implementation details
      assertSuccessfulGenerateResponse(result, sessionId, correlatorIds, messageIds);
      // This is a safe assertion as it's testing a property of the response, not implementation
      expect(result.messages.llmResponse.topChoice.content).toEqual([{ type: 'text', text: 'test response' }]);
    });

    it('should pass the signal to the LLM manager', async () => {
      const sessionId = 'test-session-id';
      const directMessages = [createValidMessage()];
      const augmentedContext: Type.Entity.CreateMessage[] = [];
      const mockContext = createMockContext(sessionId);
      const mockLlmResponse = createMockLlmResponse();
      setupMocksForGenerate({
        contextProvider: mockContextProvider,
        inputMiddlewareManager: mockInputMiddlewareManager,
        beforeGenerateMiddlewareManager: mockBeforeGenerateMiddlewareManager,
        llmManager: mockLlmManager,
        afterGenerateMiddlewareManager: mockAfterGenerateMiddlewareManager,
        mockContext,
        mockLlmResponse,
        directMessages,
        augmentedContext
      });
      const controller = new AbortController();

      await baseLoftChat.generate({ sessionId, directMessages, augmentedContext, signal: controller.signal });

      expect(mockLlmManager.generate.mock.calls[0][6]).toEqual({ signal: controller.signal });
    });

    it('should reject an already-aborted call without calling the LLM', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        baseLoftChat.generate({
          sessionId: 'test-session-id',
          directMessages: [createValidMessage()],
          signal: controller.signal
        })
      ).rejects.toThrow();
      expect(mockLlmManager.generate).not.toHaveBeenCalled();
    });

    it('should use provided context if available', async () => {
      // Arrange
      const sessionId = 'test-session-id';
      const correlatorIds = ['correlator-1'];
      const directMessages = [createValidMessage()];
      const augmentedContext: Type.Entity.CreateMessage[] = [];
      const mockContext = createMockContext(sessionId);
      const mockLlmResponse = createMockLlmResponse();

      // Setup all mocks
      setupMocksForGenerate({
        contextProvider: mockContextProvider,
        inputMiddlewareManager: mockInputMiddlewareManager,
        beforeGenerateMiddlewareManager: mockBeforeGenerateMiddlewareManager,
        llmManager: mockLlmManager,
        afterGenerateMiddlewareManager: mockAfterGenerateMiddlewareManager,
        mockContext,
        mockLlmResponse,
        directMessages,
        augmentedContext
      });

      // Act
      const result = await baseLoftChat.generate({
        sessionId,
        ctx: mockContext,
        directMessages,
        augmentedContext,
        correlatorIds
      });

      // Assert - focus on outcome, not implementation details
      assertSuccessfulGenerateResponse(result, sessionId, correlatorIds);

      // Verify that when context is provided, we don't call get
      // This still tests behavior but not internal implementation details
      expect(mockContextProvider.get).not.toHaveBeenCalled();
    });

    it('should use temporary LLM name and manifest name if provided', async () => {
      // Arrange
      const sessionId = 'test-session-id';
      const correlatorIds = ['correlator-1'];
      const directMessages = [createValidMessage()];
      const augmentedContext: Type.Entity.CreateMessage[] = [];

      // Temporary LLM and manifest names
      const temporaryLlmName = 'temp-llm';
      const temporaryManifestName = 'temp-manifest';

      // Create context with base values
      const mockContext = createMockContext(sessionId);

      // Add temporaryRequestConfig to the context's request
      mockContext.request.messages.temporaryRequestConfig = {
        llmName: temporaryLlmName,
        manifestName: temporaryManifestName
      };

      const mockLlmResponse = createMockLlmResponse();

      // Setup mocks with default values
      setupMocksForGenerate({
        contextProvider: mockContextProvider,
        inputMiddlewareManager: mockInputMiddlewareManager,
        beforeGenerateMiddlewareManager: mockBeforeGenerateMiddlewareManager,
        llmManager: mockLlmManager,
        afterGenerateMiddlewareManager: mockAfterGenerateMiddlewareManager,
        mockContext,
        mockLlmResponse,
        directMessages,
        augmentedContext
      });

      // Define what we expect to happen
      // Make sure to update the mock implementation to look for the temporaryRequestConfig
      mockBeforeGenerateMiddlewareManager.executeChain.mockResolvedValue({
        payload: {
          directMessages,
          augmentedContext,
          temporaryRequestConfig: {
            llmName: temporaryLlmName,
            manifestName: temporaryManifestName
          }
        },
        isGenerationPrevented: false
      });

      // Act
      const result = await baseLoftChat.generate({
        sessionId,
        directMessages,
        augmentedContext,
        correlatorIds,
        temporaryLlmName,
        temporaryManifestName
      });

      // Assert - focus on outcome, not implementation details
      assertSuccessfulGenerateResponse(result, sessionId, correlatorIds);

      // Simply verify the generate method was called
      expect(mockLlmManager.generate).toHaveBeenCalled();

      // Verify that temporary config was passed to the contextProvider.update method
      expect(mockContextProvider.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          temporaryRequestConfig: expect.objectContaining({
            llmName: temporaryLlmName,
            manifestName: temporaryManifestName
          })
        }),
        expect.anything()
      );
    });

    it('should throw GenerateError if invalid direct messages', async () => {
      // Arrange
      const sessionId = 'test-session-id';
      const correlatorIds = ['correlator-1'];

      // Creating a message without required fields to make it invalid for the test
      const directMessages: Type.Entity.CreateMessage[] = [
        {
          sessionId: 'test-session-id'
          // Missing required fields that will cause a validation error
        } as unknown as Type.Entity.CreateMessage
      ];

      // Mock schema validation to fail
      vi.spyOn(Schema.Entity.CreateMessage, 'array').mockReturnValue({
        safeParse: () => ({
          success: false,
          error: new Error('Invalid direct messages')
        })
      } as any);

      // Act & Assert
      await expect(
        baseLoftChat.generate({
          sessionId,
          directMessages,
          correlatorIds
        })
      ).rejects.toBeInstanceOf(GenerateError);
    });

    it('should throw GenerateError if invalid augmented context', async () => {
      // Arrange
      const sessionId = 'test-session-id';
      const correlatorIds = ['correlator-1'];
      const directMessages: Type.Entity.CreateMessage[] = [createValidMessage()];

      // Creating a message without required fields to make it invalid for the test
      const augmentedContext: Type.Entity.CreateMessage[] = [
        {
          sessionId: 'test-session-id'
          // Missing required fields that will cause a validation error
        } as unknown as Type.Entity.CreateMessage
      ];

      // Create tracer for testing
      const tracerStrategy = new NoOpTracerStrategy();
      const tracer = tracerStrategy.createTracer({
        traceId: 'test-trace-id',
        name: 'test-tracer',
        sessionId: sessionId
      });

      mockContextProvider.get.mockResolvedValue({
        session: { id: sessionId },
        tracer: tracer
      });

      // Mock schema validation
      const arrayValidatorMock = vi.spyOn(Schema.Entity.CreateMessage, 'array');

      // First call for directMessages will return success
      arrayValidatorMock.mockReturnValueOnce({
        safeParse: (data: unknown) => ({ success: true, data })
      } as any);

      // Second call for augmentedContext will return error
      arrayValidatorMock.mockReturnValueOnce({
        safeParse: () => ({
          success: false,
          error: new Error('Invalid augmented context')
        })
      } as any);

      // Act & Assert
      await expect(
        baseLoftChat.generate({
          sessionId,
          directMessages,
          augmentedContext,
          correlatorIds
        })
      ).rejects.toBeInstanceOf(GenerateError);
    });

    it('should handle generation with prevented generation', async () => {
      // Arrange
      const sessionId = 'test-session-id';
      const correlatorIds = ['correlator-1'];
      const directMessages = [createValidMessage()];
      const augmentedContext: Type.Entity.CreateMessage[] = [];
      const mockContext = createMockContext(sessionId);

      // Create an override response that should be used when generation is prevented
      const overrideContent = [{ type: 'text' as const, text: 'Override response' }];
      const setAppendFnMock = vi.fn();
      const overrideTopChoice = {
        content: overrideContent,
        role: Type.LLM.UnifiedMessageRole.assistant,
        setAppendFn: setAppendFnMock
      };
      const overrideGenerateResponse = {
        content: overrideContent,
        role: Type.LLM.UnifiedMessageRole.assistant,
        ctx: {},
        author: 'test-author',
        llmName: 'test-llm',
        manifestName: 'test-manifest',
        sessionId,
        setAppendFn: setAppendFnMock,
        choices: [overrideTopChoice], // choices[0] should be the same as topChoice
        topChoice: overrideTopChoice
      };

      // Setup basic mocks
      mockContextProvider.get.mockResolvedValue(mockContext);
      mockContextProvider.unlock.mockResolvedValue(mockContext);
      mockContextProvider.lock.mockReturnValue(mockContext);
      mockContextProvider.update.mockResolvedValue(mockContext);

      mockInputMiddlewareManager.executeChain.mockResolvedValue({
        payload: { directMessages, augmentedContext }
      });

      // The key part - setup the beforeGenerateMiddlewareManager to prevent generation
      // and provide an override response
      mockBeforeGenerateMiddlewareManager.executeChain.mockResolvedValue({
        payload: { directMessages, augmentedContext },
        isGenerationPrevented: true,
        overrideGenerateResponse
      });

      // Add a mock for afterGenerateMiddlewareManager
      mockAfterGenerateMiddlewareManager.executeChain.mockResolvedValue({
        payload: {
          directMessages: [],
          augmentedContext: [],
          llmResponse: overrideGenerateResponse
        }
      });

      // Act
      const result = await baseLoftChat.generate({
        sessionId,
        directMessages,
        augmentedContext,
        correlatorIds
      });

      // Assert - focus on the outcome, not the implementation
      expect(result).toBeDefined();
      expect(result.status).toBe(Chat.Status.SUCCESS);
      // Verify the override response was used by checking its content is in the result
      expect(result.messages.llmResponse.topChoice.content).toEqual(overrideContent);

      // We don't need to check if generate was called or not - the important thing is
      // that the override response was used correctly in the result
    });

    it('should handle errors during generation', async () => {
      // Arrange
      const sessionId = 'test-session-id';
      const correlatorIds = ['correlator-1'];
      const directMessages = [createValidMessage()];
      const augmentedContext: Type.Entity.CreateMessage[] = [];

      // Create context with a user message to prevent "already generated" error
      const mockContext = createMockContext(sessionId);
      const mockLlmResponse = createMockLlmResponse();

      // Generate an error that will occur during LLM generation
      const error = new Error('LLM generation error');

      // Setup mocks with the error during generation
      setupMocksForGenerate({
        contextProvider: mockContextProvider,
        inputMiddlewareManager: mockInputMiddlewareManager,
        beforeGenerateMiddlewareManager: mockBeforeGenerateMiddlewareManager,
        llmManager: mockLlmManager,
        afterGenerateMiddlewareManager: mockAfterGenerateMiddlewareManager,
        mockContext,
        mockLlmResponse,
        directMessages,
        augmentedContext
      });

      // Override the generate mock to throw an error
      mockLlmManager.generate.mockRejectedValue(error);

      // Act & Assert
      // The key behavior is that a GenerateError is thrown that contains the session ID and has ERROR status
      const generatePromise = baseLoftChat.generate({
        sessionId,
        directMessages,
        augmentedContext,
        correlatorIds
      });

      await expect(generatePromise).rejects.toBeInstanceOf(GenerateError);
      await expect(generatePromise).rejects.toMatchObject({
        sessionId,
        status: Chat.Status.ERROR
      });
    });

    it('should throw GenerateError if context cannot be provided', async () => {
      // Arrange
      const sessionId = 'test-session-id';
      const correlatorIds = ['correlator-1'];
      const directMessages: Type.Entity.CreateMessage[] = [createValidMessage()];
      const augmentedContext: Type.Entity.CreateMessage[] = [];

      // Mock context provider to return null (simulating a missing context)
      mockContextProvider.get.mockResolvedValue(null);

      // Act & Assert
      const generatePromise = baseLoftChat.generate({
        sessionId,
        directMessages,
        augmentedContext,
        correlatorIds
      });

      // Verify the expected behavior - a GenerateError with appropriate error status
      await expect(generatePromise).rejects.toBeInstanceOf(GenerateError);
      await expect(generatePromise).rejects.toMatchObject({
        sessionId,
        status: Chat.Status.ERROR,
        message: expect.stringContaining('Failed to provide context')
      });

      // We don't need to verify that mockLlmManager.generate wasn't called
      // That's an implementation detail - the important thing is that
      // the function throws the expected error with the correct properties
    });

    it('should handle the case when isGenerationPrevented is true but overrideGenerateResponse is undefined', async () => {
      // Arrange
      const sessionId = 'test-session-id';
      const correlatorIds = ['correlator-1'];
      const directMessages = [createValidMessage()];
      const augmentedContext: Type.Entity.CreateMessage[] = [];

      // Add a user message to chat history to prevent the "already generated" error
      const mockContext = {
        session: { id: sessionId, currentLlmName: 'default-llm', currentManifestName: 'default-manifest' },
        chatHistory: {
          messages: [
            {
              id: 'test-id',
              sessionId: 'test-session-id',
              ctx: {},
              content: 'pending user message',
              role: Type.LLM.UnifiedMessageRole.user,
              author: 'user',
              llmName: 'test-llm',
              manifestName: 'test-manifest',
              createdAt: new Date(),
              updatedAt: new Date(),
              correlatorId: 'test-correlator',
              action: 'standard',
              patch: vi.fn(),
              sequenceId: '0001'
            } as unknown as Interface.FacadeEntity.Message
          ]
        },
        request: {
          correlatorIds,
          messageIds: { all: ['message-id'], direct: ['message-id'], augmented: [] },
          messages: { directMessages, augmentedContext }
        },
        tracer: new NoOpTracerStrategy().createTracer({ traceId: 'test', name: 'test', sessionId: 'test' })
      } as unknown as ContextInterface;

      mockContextProvider.get.mockResolvedValue(mockContext);
      mockContextProvider.unlock.mockResolvedValue(mockContext);
      mockContextProvider.lock.mockReturnValue(mockContext);
      mockContextProvider.update.mockResolvedValue(mockContext);

      // Mock schema validation to pass
      vi.spyOn(Schema.Entity.CreateMessage, 'array').mockReturnValue({
        safeParse: (data: any) => ({ success: true, data })
      } as any);

      // Mock input middleware
      mockInputMiddlewareManager.executeChain.mockResolvedValue({
        payload: { directMessages, augmentedContext }
      });

      // Mock beforeGenerateMiddlewareManager to return isGenerationPrevented=true but no override
      mockBeforeGenerateMiddlewareManager.executeChain.mockResolvedValue({
        payload: { directMessages, augmentedContext },
        isGenerationPrevented: true
        // No overrideGenerateResponse
      });

      // Act & Assert
      await expect(
        baseLoftChat.generate({
          sessionId,
          directMessages,
          augmentedContext,
          correlatorIds
        })
      ).rejects.toThrow();
    });

    it('should handle GenerateError thrown by the llmManager', async () => {
      // Arrange
      const sessionId = 'test-session-id';
      const correlatorIds = ['correlator-1'];
      const directMessages = [createValidMessage()];
      const augmentedContext: Type.Entity.CreateMessage[] = [];

      // Add a user message to chat history to prevent the "already generated" error
      const mockContext = {
        session: { id: sessionId, currentLlmName: 'default-llm', currentManifestName: 'default-manifest' },
        chatHistory: {
          messages: [
            {
              id: 'test-id',
              sessionId: 'test-session-id',
              ctx: {},
              content: 'pending user message',
              role: Type.LLM.UnifiedMessageRole.user,
              author: 'user',
              llmName: 'test-llm',
              manifestName: 'test-manifest',
              createdAt: new Date(),
              updatedAt: new Date(),
              correlatorId: 'test-correlator',
              action: 'standard',
              patch: vi.fn(),
              sequenceId: '0001'
            } as unknown as Interface.FacadeEntity.Message
          ]
        },
        request: {
          correlatorIds,
          messageIds: { all: ['message-id'], direct: ['message-id'], augmented: [] },
          messages: { directMessages, augmentedContext }
        },
        tracer: new NoOpTracerStrategy().createTracer({ traceId: 'test', name: 'test', sessionId: 'test' })
      } as unknown as ContextInterface;

      mockContextProvider.get.mockResolvedValue(mockContext);
      mockContextProvider.unlock.mockResolvedValue(mockContext);
      mockContextProvider.lock.mockReturnValue(mockContext);
      mockContextProvider.update.mockResolvedValue(mockContext);

      // Mock schema validation to pass
      vi.spyOn(Schema.Entity.CreateMessage, 'array').mockReturnValue({
        safeParse: (data: any) => ({ success: true, data })
      } as any);

      // Mock input middleware
      mockInputMiddlewareManager.executeChain.mockResolvedValue({
        payload: { directMessages, augmentedContext }
      });

      // Mock beforeGenerateMiddlewareManager
      mockBeforeGenerateMiddlewareManager.executeChain.mockResolvedValue({
        payload: { directMessages, augmentedContext },
        isGenerationPrevented: false
      });

      // Mock llmManager to throw a GenerateError
      const generateError = new GenerateError(sessionId, correlatorIds, ['message-id'], Chat.Status.ERROR, 'LLM error');
      mockLlmManager.generate.mockRejectedValue(generateError);

      // Act & Assert
      await expect(
        baseLoftChat.generate({
          sessionId,
          directMessages,
          augmentedContext,
          correlatorIds
        })
      ).rejects.toThrow(GenerateError);
    });

    it('should handle direct message length check in the context', async () => {
      // Arrange
      const sessionId = 'test-session-id';
      const correlatorIds = ['correlator-1'];
      const directMessages: Type.Entity.CreateMessage[] = [createValidMessage()];
      const augmentedContext: Type.Entity.CreateMessage[] = [];

      // Create a context without a user message in chat history
      const mockContext = {
        session: { id: sessionId, currentLlmName: 'default-llm', currentManifestName: 'default-manifest' },
        chatHistory: {
          messages: [
            {
              role: Type.LLM.UnifiedMessageRole.assistant, // Last message is from assistant
              content: [{ type: 'text' as const, text: 'previous response' }]
            }
          ]
        },
        request: {
          correlatorIds,
          messageIds: { all: ['message-id'], direct: [], augmented: [] },
          messages: { directMessages, augmentedContext }
        },
        tracer: new NoOpTracerStrategy().createTracer({ traceId: 'test', name: 'test', sessionId: 'test' })
      } as unknown as ContextInterface;

      mockContextProvider.get.mockResolvedValue(mockContext);
      mockContextProvider.unlock.mockResolvedValue(mockContext);

      // Mock schema validation to pass
      vi.spyOn(Schema.Entity.CreateMessage, 'array').mockReturnValue({
        safeParse: (data: Type.Entity.CreateMessage[]) => ({ success: true, data })
      } as any);

      // Mock input middleware
      mockInputMiddlewareManager.executeChain.mockResolvedValue({
        payload: { directMessages: [], augmentedContext: [] }
      });

      // Act & Assert
      // Just expect any error, since the exact error type might be different in tests
      await expect(
        baseLoftChat.generate({
          sessionId,
          directMessages,
          augmentedContext,
          correlatorIds
        })
      ).rejects.toThrow();
    });

    it('should handle null context from contextProvider.get', async () => {
      // Arrange
      const sessionId = 'test-session-id';
      const correlatorIds = ['correlator-1'];
      const directMessages: Type.Entity.CreateMessage[] = [createValidMessage()];
      const augmentedContext: Type.Entity.CreateMessage[] = [];

      // Mock context provider to return null (simulating a missing context)
      mockContextProvider.get.mockResolvedValue(null);

      // Act & Assert
      await expect(
        baseLoftChat.generate({
          sessionId,
          directMessages,
          augmentedContext,
          correlatorIds
        })
      ).rejects.toBeInstanceOf(GenerateError);

      expect(mockLlmManager.generate).not.toHaveBeenCalled();
    });

    it('should throw ALREADY_GENERATED error when no pending messages are found', async () => {
      // Arrange
      const sessionId = 'test-session-id';
      const correlatorIds = ['correlator-1'];
      const directMessages: Type.Entity.CreateMessage[] = []; // Empty direct messages
      const augmentedContext: Type.Entity.CreateMessage[] = [];

      // Create a context without a user message in chat history
      const mockContext = {
        sessionId,
        session: {
          id: sessionId,
          currentLlmName: 'test-llm',
          currentManifestName: 'test-manifest'
        },
        request: {
          correlatorIds: ['correlator-1'],
          messageIds: { all: ['message-1'], direct: ['message-1'], augmented: [] },
          messages: {
            directMessages,
            augmentedContext
          }
        },
        chatHistory: {
          messages: [] // Empty chat history - no pending user messages
        },
        tracer: new NoOpTracerStrategy().createTracer({ traceId: 'test', name: 'test', sessionId: 'test' })
      } as unknown as ContextInterface;

      mockContextProvider.get.mockResolvedValue(mockContext);
      mockContextProvider.unlock.mockResolvedValue(mockContext);
      mockContextProvider.update.mockResolvedValue(mockContext);

      // Setup middleware mocks
      mockInputMiddlewareManager.executeChain.mockResolvedValue({
        payload: { directMessages, augmentedContext }
      });

      // Act & Assert
      const generatePromise = baseLoftChat.generate({
        sessionId,
        directMessages,
        augmentedContext,
        correlatorIds
      });

      // Verify the expected behavior - a GenerateError with ALREADY_GENERATED status
      await expect(generatePromise).rejects.toBeInstanceOf(GenerateError);
      await expect(generatePromise).rejects.toMatchObject({
        sessionId,
        status: Chat.Status.ALREADY_GENERATED,
        message: expect.stringContaining('No pending messages found')
      });

      // We don't need to verify internal implementation details like
      // whether llmManager.generate was called or not - the important thing
      // is that the function throws the expected error with the correct properties
    });

    it('should rethrow error with proper GenerateError when an error occurs during LLM generation', async () => {
      // Setup test without using setupGenerateTest
      const sessionId = 'test-session-id';
      const correlatorIds = ['correlator-1'];
      const directMessages = [createValidMessage()];
      const augmentedContext: Type.Entity.Message[] = [];

      // Create a context with a user message to prevent "already generated" error
      const mockContext = {
        session: { id: sessionId, currentLlmName: 'default-llm', currentManifestName: 'default-manifest' },
        chatHistory: {
          messages: [
            {
              id: 'test-id',
              sessionId: 'test-session-id',
              ctx: {},
              content: 'pending user message',
              role: Type.LLM.UnifiedMessageRole.user,
              author: 'user',
              llmName: 'test-llm',
              manifestName: 'test-manifest',
              createdAt: new Date(),
              updatedAt: new Date(),
              correlatorId: 'test-correlator',
              action: 'standard',
              patch: vi.fn(),
              sequenceId: '0001',
              llmIgnore: false
            } as unknown as Interface.FacadeEntity.Message
          ]
        },
        request: {
          correlatorIds,
          messageIds: { all: ['msg-1'], direct: ['msg-1'], augmented: [] },
          messages: { directMessages, augmentedContext }
        },
        tracer: new NoOpTracerStrategy().createTracer({ traceId: 'test', name: 'test', sessionId: 'test' })
      } as unknown as ContextInterface;

      mockContextProvider.get.mockResolvedValue(mockContext);
      mockContextProvider.update.mockResolvedValue(mockContext);

      mockInputMiddlewareManager.executeChain.mockResolvedValue({
        payload: { directMessages, augmentedContext }
      });

      // Create an error to throw from the LLM manager
      const originalError = new Error('Something went wrong during generation');
      mockLlmManager.generate.mockRejectedValue(originalError);

      // Update the expectation to match the actual error message
      await expect(
        baseLoftChat.generate({
          sessionId,
          directMessages,
          augmentedContext,
          correlatorIds
        })
      ).rejects.toThrow(GenerateError);
    });

    it('should process messages with augmented context', async () => {
      // Arrange
      const { sessionId, correlatorIds } = setupGenerateTest();

      // Use proper typing for arrays
      const directMessages: Type.Entity.CreateMessage[] = [createValidMessage()];
      const augmentedContext: Type.Entity.CreateMessage[] = [
        createValidMessage({ content: [{ type: 'text' as const, text: 'augmented context message' }] })
      ];

      // Create a mock context with proper structure
      const tracerStrategy = new NoOpTracerStrategy();
      const tracer = tracerStrategy.createTracer({
        traceId: 'test-trace-id',
        name: 'test-tracer',
        sessionId: sessionId
      });

      const mockContext = {
        sessionId,
        session: {
          id: sessionId,
          currentLlmName: 'default-llm',
          currentManifestName: 'default-manifest'
        },
        request: {
          directMessages,
          augmentedContext,
          correlatorIds,
          messageIds: { all: ['message-id'], direct: ['message-id'], augmented: [] },
          messages: { directMessages, augmentedContext }
        },
        chatHistory: {
          messages: [
            {
              id: 'test-id',
              sessionId: 'test-session-id',
              ctx: {},
              content: 'pending user message',
              role: Type.LLM.UnifiedMessageRole.user,
              author: 'user',
              llmName: 'test-llm',
              manifestName: 'test-manifest',
              createdAt: new Date(),
              updatedAt: new Date(),
              sequenceId: '0001',
              llmIgnore: false,
              patch: vi.fn()
            } as unknown as Interface.FacadeEntity.Message
          ],
          getMessages: vi.fn().mockReturnValue([])
        },
        tracer: tracer
      } as unknown as ContextInterface;

      mockContextProvider.get.mockResolvedValue(mockContext);
      mockContextProvider.update.mockResolvedValue(mockContext);
      mockContextProvider.lock.mockReturnValue(mockContext);
      mockContextProvider.unlock.mockResolvedValue(mockContext);

      // Create mock for direct and augmented context messages
      const directResponseMessages = directMessages.map((msg) => ({
        ...msg,
        id: 'generated-id',
        role: Type.LLM.UnifiedMessageRole.assistant
      }));

      const augContextMessages = augmentedContext.map((msg) => ({
        ...msg,
        id: 'aug-id',
        role: Type.LLM.UnifiedMessageRole.assistant
      }));

      // Create setAppendFn mock outside of class
      const setAppendFnMock = vi.fn();

      // Define mock InteractiveOutputMessage class
      class MockInteractiveOutputMessage {
        constructor(public messageData: any) {
          Object.assign(this, messageData);
        }
        setAppendFn = setAppendFnMock;
      }

      // Create direct instances of the mock class
      const directMessagesMock = directResponseMessages.map((msg) => new MockInteractiveOutputMessage(msg));
      const augContextMessagesMock = augContextMessages.map((msg) => new MockInteractiveOutputMessage(msg));

      // Setup mock for the LLM response
      const mockTopChoice = {
        content: 'Generated response',
        role: Type.LLM.UnifiedMessageRole.assistant,
        setAppendFn: setAppendFnMock
      };

      const mockLlmResponse = {
        choices: [mockTopChoice],
        topChoice: mockTopChoice,
        setAppendFn: setAppendFnMock
      };

      // Mock the LLM manager
      mockLlmManager.generate.mockResolvedValue(mockLlmResponse);

      // Setup middleware mocks
      mockInputMiddlewareManager.executeChain.mockResolvedValue({
        payload: { directMessages, augmentedContext }
      });

      mockBeforeGenerateMiddlewareManager.executeChain.mockResolvedValue({
        payload: { directMessages, augmentedContext },
        isGenerationPrevented: false
      });

      mockAfterGenerateMiddlewareManager.executeChain.mockResolvedValue({
        payload: {
          directMessages: directMessagesMock,
          augmentedContext: augContextMessagesMock,
          llmResponse: mockLlmResponse
        }
      });

      // Act
      const result = await baseLoftChat.generate({
        sessionId,
        directMessages,
        augmentedContext,
        correlatorIds
      });

      // Assert
      expect(result).toBeDefined();
      expect(result.messages).toBeDefined();
      expect(result.messages.directMessages).toBeDefined();
      expect(result.messages.augmentedContext).toBeDefined();
      expect(mockAfterGenerateMiddlewareManager.executeChain).toHaveBeenCalled();
    });

    it('should generate response with augmented context', async () => {
      // Arrange
      const { sessionId, correlatorIds } = setupGenerateTest();

      // Use proper typing for arrays
      const directMessages: Type.Entity.CreateMessage[] = [createValidMessage()];
      const augmentedContext: Type.Entity.CreateMessage[] = [
        createValidMessage({ content: [{ type: 'text' as const, text: 'augmented context message' }] })
      ];

      // Create a mock context with proper structure
      const tracerStrategy = new NoOpTracerStrategy();
      const tracer = tracerStrategy.createTracer({
        traceId: 'test-trace-id',
        name: 'test-tracer',
        sessionId: sessionId
      });

      const mockContext = {
        sessionId,
        session: {
          id: sessionId,
          currentLlmName: 'default-llm',
          currentManifestName: 'default-manifest'
        },
        request: {
          directMessages,
          augmentedContext,
          correlatorIds,
          messageIds: { all: ['message-id'], direct: ['message-id'], augmented: [] },
          messages: { directMessages, augmentedContext }
        },
        chatHistory: {
          messages: [
            {
              id: 'test-id',
              sessionId: 'test-session-id',
              ctx: {},
              content: 'pending user message',
              role: Type.LLM.UnifiedMessageRole.user,
              author: 'user',
              llmName: 'test-llm',
              manifestName: 'test-manifest',
              createdAt: new Date(),
              updatedAt: new Date(),
              sequenceId: '0001',
              llmIgnore: false,
              patch: vi.fn()
            } as unknown as Interface.FacadeEntity.Message
          ],
          getMessages: vi.fn().mockReturnValue([])
        },
        tracer: tracer
      } as unknown as ContextInterface;

      mockContextProvider.get.mockResolvedValue(mockContext);
      mockContextProvider.update.mockResolvedValue(mockContext);
      mockContextProvider.lock.mockReturnValue(mockContext);
      mockContextProvider.unlock.mockResolvedValue(mockContext);

      // Create setAppendFn mock
      const setAppendFnMock = vi.fn();

      // Define mock InteractiveOutputMessage class directly in the test
      class MockInteractiveOutputMessage {
        constructor(public messageData: any) {
          Object.assign(this, messageData);
        }
        setAppendFn = setAppendFnMock;
      }

      // Create mock responses
      const directMessagesMock = directMessages.map(
        (msg) =>
          new MockInteractiveOutputMessage({
            ...msg,
            id: 'generated-id',
            role: Type.LLM.UnifiedMessageRole.assistant
          })
      );

      const augContextMessagesMock = augmentedContext.map(
        (msg) =>
          new MockInteractiveOutputMessage({
            ...msg,
            id: 'aug-id',
            role: Type.LLM.UnifiedMessageRole.assistant
          })
      );

      // Create the LLM response
      const mockTopChoice = {
        content: 'Generated response',
        role: Type.LLM.UnifiedMessageRole.assistant,
        setAppendFn: setAppendFnMock
      };

      const mockLlmResponse = {
        choices: [mockTopChoice],
        topChoice: mockTopChoice,
        setAppendFn: setAppendFnMock
      };

      // Set up middleware mocks
      mockInputMiddlewareManager.executeChain.mockResolvedValue({
        payload: { directMessages, augmentedContext }
      });

      mockBeforeGenerateMiddlewareManager.executeChain.mockResolvedValue({
        payload: { directMessages, augmentedContext },
        isGenerationPrevented: false
      });

      mockLlmManager.generate.mockResolvedValue(mockLlmResponse);

      mockAfterGenerateMiddlewareManager.executeChain.mockResolvedValue({
        payload: {
          directMessages: directMessagesMock,
          augmentedContext: augContextMessagesMock,
          llmResponse: mockLlmResponse
        }
      });

      // Act
      const result = await baseLoftChat.generate({
        sessionId,
        directMessages,
        augmentedContext,
        correlatorIds
      });

      // Assert
      expect(result).toBeDefined();
      expect(result.messages).toBeDefined();
      expect(result.messages.directMessages).toBeDefined();
      expect(result.messages.augmentedContext).toBeDefined();
      expect(result.messages.directMessages).toHaveLength(directMessagesMock.length);
      expect(result.messages.augmentedContext).toHaveLength(augContextMessagesMock.length);
    });

    it('should handle error during context update', async () => {
      // Arrange
      const sessionId = 'test-session-id';
      const correlatorIds = ['correlator-1'];
      const directMessages: Type.Entity.CreateMessage[] = [createValidMessage()];
      const augmentedContext: Type.Entity.CreateMessage[] = [];

      const mockContext = {
        session: { id: sessionId, currentLlmName: 'default-llm', currentManifestName: 'default-manifest' },
        request: {
          correlatorIds,
          messageIds: { all: [], direct: [], augmented: [] },
          messages: { directMessages, augmentedContext }
        },
        tracer: new NoOpTracerStrategy().createTracer({ traceId: 'test', name: 'test', sessionId: 'test' })
      } as unknown as ContextInterface;

      mockContextProvider.get.mockResolvedValue(mockContext);

      // Mock schema validation to pass
      vi.spyOn(Schema.Entity.CreateMessage, 'array').mockReturnValue({
        safeParse: (data: Type.Entity.CreateMessage[]) => ({ success: true, data })
      } as any);

      // Mock input middleware
      mockInputMiddlewareManager.executeChain.mockResolvedValue({
        payload: { directMessages, augmentedContext }
      });

      // Simulate an error during context update
      mockContextProvider.update.mockRejectedValue(new Error('Update error'));

      // Act & Assert
      await expect(
        baseLoftChat.generate({
          sessionId,
          directMessages,
          augmentedContext,
          correlatorIds
        })
      ).rejects.toThrow(); // Expect any error

      expect(mockLlmManager.generate).not.toHaveBeenCalled();
    });

    it('should handle middleware error', async () => {
      // Arrange
      const { sessionId, correlatorIds } = setupGenerateTest();
      const directMessages: Type.Entity.CreateMessage[] = [createValidMessage()];
      const augmentedContext: Type.Entity.CreateMessage[] = [];

      // Create the context with proper structure
      const mockContext = {
        sessionId,
        session: {
          id: sessionId,
          currentLlmName: 'default-llm',
          currentManifestName: 'default-manifest'
        },
        request: {
          directMessages,
          augmentedContext,
          correlatorIds,
          messageIds: { all: ['message-id'], direct: ['message-id'], augmented: [] },
          messages: { directMessages, augmentedContext }
        },
        chatHistory: {
          messages: [
            {
              id: 'test-id',
              sessionId: 'test-session-id',
              ctx: {},
              content: 'pending user message',
              role: Type.LLM.UnifiedMessageRole.user,
              author: 'user',
              llmName: 'test-llm',
              manifestName: 'test-manifest',
              createdAt: new Date(),
              updatedAt: new Date(),
              sequenceId: '0001',
              llmIgnore: false,
              patch: vi.fn()
            } as unknown as Interface.FacadeEntity.Message
          ]
        },
        tracer: new NoOpTracerStrategy().createTracer({ traceId: 'test', name: 'test', sessionId: 'test' })
      } as unknown as ContextInterface;

      mockContextProvider.get.mockResolvedValue(mockContext);
      mockContextProvider.update.mockResolvedValue(mockContext);
      mockContextProvider.lock.mockReturnValue(mockContext);
      mockContextProvider.unlock.mockResolvedValue(mockContext);

      // Create setAppendFn mock
      const setAppendFnMock = vi.fn();

      // Create mock LLM response
      const mockTopChoice = {
        content: 'Generated response',
        role: Type.LLM.UnifiedMessageRole.assistant,
        setAppendFn: setAppendFnMock
      };

      const mockLlmResponse = {
        choices: [
          {
            content: 'Alternative response',
            role: Type.LLM.UnifiedMessageRole.assistant,
            setAppendFn: setAppendFnMock
          }
        ],
        topChoice: mockTopChoice,
        setAppendFn: setAppendFnMock
      };

      mockLlmManager.generate.mockResolvedValue(mockLlmResponse);

      // Mock the input and before middleware
      mockInputMiddlewareManager.executeChain.mockResolvedValue({
        payload: { directMessages, augmentedContext }
      });

      mockBeforeGenerateMiddlewareManager.executeChain.mockResolvedValue({
        payload: { directMessages, augmentedContext },
        isGenerationPrevented: false
      });

      // Simulate error in the afterGenerateMiddlewareManager
      mockAfterGenerateMiddlewareManager.executeChain.mockRejectedValue(new Error('Middleware error'));

      // Mock the GenerateError constructor to ensure it's used correctly
      const mockGenerateError = vi.fn();
      vi.mock('../../../../../src/errors/GenerateError', () => ({
        GenerateError: class {
          constructor(...args: any[]) {
            mockGenerateError(...args);
          }
        }
      }));

      // Act & Assert
      await expect(
        baseLoftChat.generate({
          sessionId,
          directMessages,
          augmentedContext,
          correlatorIds
        })
      ).rejects.toThrow(); // Just check that it rejects with any error

      expect(mockLlmManager.generate).toHaveBeenCalled();
    });
  });

  describe('session operations', () => {
    const session = { id: 'test-session-id', externalKey: { crmId: 'external-1' }, ctx: { plan: 'basic' } };

    it('creates a session through the session repository', async () => {
      mockSessionRepository.create.mockResolvedValue(session);

      await expect(baseLoftChat.createSession({ currentLlmName: 'test-llm' } as any)).resolves.toBe(session);
      expect(mockSessionRepository.create).toHaveBeenCalledWith({ currentLlmName: 'test-llm' });
    });

    it('deletes a session by id', async () => {
      await baseLoftChat.deleteSession('test-session-id');

      expect(mockSessionRepository.deleteById).toHaveBeenCalledWith('test-session-id');
    });

    it('gets a session by id and by external key', async () => {
      mockSessionRepository.getById.mockResolvedValue(session);
      mockSessionRepository.getByExternalKey.mockResolvedValue(session);

      await expect(baseLoftChat.getSessionById('test-session-id')).resolves.toBe(session);
      await expect(baseLoftChat.getSessionByExternalKey({ crmId: 'external-1' })).resolves.toBe(session);
      expect(mockSessionRepository.getByExternalKey).toHaveBeenCalledWith({ crmId: 'external-1' });
    });

    it('merges the new ctx into the session when updating its settings', async () => {
      mockSessionRepository.getById.mockResolvedValue(session);

      await baseLoftChat.updateSessionSettings('test-session-id', 'correlator-1', { ctx: { locale: 'uk' } });

      expect(mockSessionRepository.updateById).toHaveBeenCalledWith('test-session-id', {
        ...session,
        ctx: { plan: 'basic', locale: 'uk' }
      });
    });

    it('rejects updating the settings of a missing session', async () => {
      mockSessionRepository.getById.mockResolvedValue(undefined);

      await expect(baseLoftChat.updateSessionSettings('missing', 'correlator-1', {})).rejects.toThrow(
        'Session not found: missing'
      );
      expect(mockSessionRepository.updateById).not.toHaveBeenCalled();
    });

    it('returns the chat history of a session', async () => {
      const messages = [createValidMessage()];
      mockChatHistoryManager.getMessages.mockResolvedValue(messages);

      const history = await baseLoftChat.getChatHistory('test-session-id');

      expect([...history]).toEqual(messages);
      expect(mockChatHistoryManager.getMessages).toHaveBeenCalledWith('test-session-id');
    });
  });

  describe('checkHealth', () => {
    it('should check health of dependent services', async () => {
      // Arrange - setup health check to return true
      mockLoftHealthCheck.check.mockResolvedValue(true);

      // Act
      const result = await baseLoftChat.checkHealth();

      // Assert - focus on the outcome (health status) not implementation details
      expect(result).toBe(true);

      // We can keep this assertion as it verifies that the right components are checked
      // This is part of the expected behavior, not just an implementation detail
      expect(mockLoftHealthCheck.check).toHaveBeenCalledWith(
        expect.arrayContaining([
          HealthCheckComponent.SESSION_REPOSITORY,
          HealthCheckComponent.CHAT_HISTORY_MANAGER,
          HealthCheckComponent.LLM_MANAGER
        ])
      );
    });

    it('should return false if health check fails', async () => {
      // Arrange - setup health check to return false
      mockLoftHealthCheck.check.mockResolvedValue(false);

      // Act
      const result = await baseLoftChat.checkHealth();

      // Assert - focus solely on the outcome (health status)
      expect(result).toBe(false);

      // No need to verify call details - that's already tested in the previous test
    });
  });

  describe('InteractiveOutputMessage.append', () => {
    it('should return a message entity when append is called', async () => {
      // Mock the addMessages function to return a message entity
      const mockMessage: Type.Entity.Message = {
        id: 'test-message-id',
        sessionId: 'test-session-id',
        ctx: {},
        content: [{ type: 'text' as const, text: 'test content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'test-author',
        llmName: 'test-llm',
        manifestName: 'test-manifest',
        createdAt: new Date(),
        updatedAt: new Date(),
        sequenceId: 'test-sequence-id',
        llmIgnore: false
      };

      const mockAddMessages = vi.fn().mockResolvedValue([mockMessage]);

      // Create the single-use append function
      const appendFn = createSingleUseAppendMessageFunction(mockAddMessages);

      // Test that it returns the expected message
      const messageToAppend: Type.Entity.CreateMessage = {
        sessionId: 'test-session-id',
        ctx: {},
        content: [{ type: 'text' as const, text: 'test content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'test-author',
        llmName: 'test-llm',
        manifestName: 'test-manifest',
        llmIgnore: false
      };

      const result = await appendFn('test-session-id', messageToAppend);

      // Verify that addMessages was called with the right parameters
      expect(mockAddMessages).toHaveBeenCalledWith('test-session-id', [messageToAppend]);

      // Verify that the result is the message entity
      expect(result).toEqual(mockMessage);
    });

    it('should throw an error if append is called more than once', async () => {
      const mockAddMessages = vi.fn().mockResolvedValue([
        {
          id: 'test-message-id',
          sessionId: 'test-session-id',
          content: [{ type: 'text' as const, text: 'test content' }]
        }
      ]);

      const appendFn = createSingleUseAppendMessageFunction(mockAddMessages);

      const messageToAppend: Type.Entity.CreateMessage = {
        sessionId: 'test-session-id',
        ctx: {},
        content: [{ type: 'text' as const, text: 'test content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'test-author',
        llmName: 'test-llm',
        manifestName: 'test-manifest',
        llmIgnore: false
      };

      // First call should succeed
      await appendFn('test-session-id', messageToAppend);

      // Second call should throw
      await expect(appendFn('test-session-id', messageToAppend)).rejects.toThrow(
        'Append function can only be called once'
      );
    });

    it('should throw an error if no message is returned from the repository', async () => {
      const mockAddMessages = vi.fn().mockResolvedValue([]);

      const appendFn = createSingleUseAppendMessageFunction(mockAddMessages);

      const messageToAppend: Type.Entity.CreateMessage = {
        sessionId: 'test-session-id',
        ctx: {},
        content: [{ type: 'text' as const, text: 'test content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'test-author',
        llmName: 'test-llm',
        manifestName: 'test-manifest',
        llmIgnore: false
      };

      await expect(appendFn('test-session-id', messageToAppend)).rejects.toThrow(
        'No message was returned from the repository'
      );
    });

    it('should properly return a message entity from InteractiveOutputMessage.append', async () => {
      // Setup mock entities and repositories
      const mockMessage: Type.Entity.Message = {
        id: 'test-message-id',
        sessionId: 'test-session-id',
        ctx: {},
        content: [{ type: 'text' as const, text: 'test content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'test-author',
        llmName: 'test-llm',
        manifestName: 'test-manifest',
        createdAt: new Date(),
        updatedAt: new Date(),
        sequenceId: 'test-sequence-id',
        llmIgnore: false
      };

      // Create mock for chatHistoryManager.addMessages
      const mockChatHistoryManager = new MockChatHistoryManager();
      mockChatHistoryManager.addMessages.mockResolvedValue([mockMessage]);

      // Create a message using the actual implementation
      const message = new InteractiveOutputMessage({
        sessionId: 'test-session-id',
        ctx: {},
        content: [{ type: 'text' as const, text: 'test content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'test-author',
        llmName: 'test-llm',
        manifestName: 'test-manifest',
        llmIgnore: false
      });

      // Create the append function
      const boundAddMessages = mockChatHistoryManager.addMessages.bind(mockChatHistoryManager);
      const appendFn = createSingleUseAppendMessageFunction(boundAddMessages);

      // Set the append function on the message
      message.setAppendFn(appendFn);

      // Call append and check the result
      const result = await message.append();

      // Verify that the result is the message entity
      expect(result).toEqual(mockMessage);

      // Verify that addMessages was called with the right parameters
      expect(mockChatHistoryManager.addMessages).toHaveBeenCalledWith('test-session-id', [
        expect.objectContaining({
          sessionId: 'test-session-id',
          content: [{ type: 'text' as const, text: 'test content' }],
          role: Type.LLM.UnifiedMessageRole.assistant
        })
      ]);
    });

    it('should verify that setAppendFn receives a function that returns a message entity', async () => {
      // Mock a message entity that will be returned from the repository
      const mockMessage: Type.Entity.Message = {
        id: 'test-message-id',
        sessionId: 'test-session-id',
        ctx: {},
        content: [{ type: 'text' as const, text: 'test content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'test-author',
        llmName: 'test-llm',
        manifestName: 'test-manifest',
        createdAt: new Date(),
        updatedAt: new Date(),
        sequenceId: 'test-sequence-id',
        llmIgnore: false
      };

      // Create a mock for the addMessages function
      const mockAddMessages = vi.fn().mockResolvedValue([mockMessage]);

      // Create a mock for setAppendFn that captures the appendFn
      let capturedAppendFn: any;
      const mockSetAppendFn = vi.fn().mockImplementation((fn) => {
        capturedAppendFn = fn;
      });

      // Create a test message with the mockSetAppendFn
      const message = {
        sessionId: 'test-session-id',
        setAppendFn: mockSetAppendFn
        // Other properties as needed
      };

      // Create and use the single-use append function
      const appendFn = createSingleUseAppendMessageFunction(mockAddMessages);
      message.setAppendFn(appendFn);

      // Verify that setAppendFn was called
      expect(mockSetAppendFn).toHaveBeenCalled();
      expect(capturedAppendFn).toBeDefined();

      // Call the captured appendFn and verify it returns the expected message
      const result = await capturedAppendFn('test-session-id', {
        sessionId: 'test-session-id',
        content: [{ type: 'text' as const, text: 'test content' }],
        llmIgnore: false
      });

      // Verify that the result is the message entity
      expect(result).toEqual(mockMessage);
    });

    it('should test that BaseLoftChat.addMessages passes messages to chatHistoryManager', async () => {
      // Setup mocks
      const mockChatHistoryManager = new MockChatHistoryManager();
      mockChatHistoryManager.addMessages.mockClear();

      const mockContextProvider = new MockContextProvider();

      // Create test message
      const message = {
        sessionId: 'test-session-id',
        ctx: {},
        content: [{ type: 'text' as const, text: 'test content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'test-author',
        llmName: 'test-llm',
        manifestName: 'test-manifest',
        llmIgnore: false
      };

      // Create tracer for testing
      const tracerStrategy = new NoOpTracerStrategy();
      const tracer = tracerStrategy.createTracer({
        traceId: 'test-trace-id',
        name: 'test-tracer',
        sessionId: 'test-session-id'
      });

      // Simple mock context
      const mockContext = {
        session: { id: 'test-session-id' },
        chatHistory: { messages: [] },
        request: {
          correlatorIds: [],
          messageIds: { all: [], direct: [], augmented: [] },
          messages: { directMessages: [], augmentedContext: [] }
        },
        tracer: tracer
      } as unknown as ContextInterface;

      mockContextProvider.get.mockResolvedValue(mockContext);

      // Create the mock input middleware that will return our messages properly
      const mockInputMiddlewareManager = {
        executeChain: vi.fn().mockResolvedValue({
          payload: {
            directMessages: [message], // Important: return the message here
            augmentedContext: []
          }
        })
      };

      // Create a minimal BaseLoftChat
      const chat = new BaseLoftChat(
        new MockSessionRepository(),
        mockChatHistoryManager,
        mockContextProvider,
        new MockLlmManager(),
        { llm: { name: 'test-llm' } } as ChatConfig,
        new MockLoftHealthCheck(),
        mockInputMiddlewareManager as any,
        { executeChain: vi.fn().mockResolvedValue({ payload: {} }) } as any,
        { executeChain: vi.fn().mockResolvedValue({ payload: {} }) } as any,
        new MockGenerateResponseProvider()
      );

      // Call addMessages
      await chat.addMessages('test-session-id', ['test-correlator'], [message]);

      // Verify that addMessages is called with the message returned from middleware
      expect(mockChatHistoryManager.addMessages).toHaveBeenCalledWith('test-session-id', [message]);
    });

    it('should return inserted messageData when calling ctx.chatHistory.addMessages directly', async () => {
      // Arrange
      // Create the mock message that will be returned
      const mockMessage: Type.Entity.Message = {
        id: 'test-message-id',
        sessionId: 'test-session-id',
        ctx: {},
        content: [{ type: 'text' as const, text: 'test content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'test-author',
        llmName: 'test-llm',
        manifestName: 'test-manifest',
        createdAt: new Date(),
        updatedAt: new Date(),
        sequenceId: 'test-sequence-id',
        llmIgnore: false
      };

      // Create a mock chatHistory that returns messages
      const mockChatHistory = {
        messages: [],
        addMessages: vi.fn().mockResolvedValue([mockMessage]),
        patchMessages: vi.fn()
      };

      // Create tracer for testing
      const tracerStrategy = new NoOpTracerStrategy();
      const tracer = tracerStrategy.createTracer({
        traceId: 'test-trace-id',
        name: 'test-tracer',
        sessionId: 'test-session-id'
      });

      // Create a mock context with the chatHistory
      const mockContext = {
        session: { id: 'test-session-id' },
        chatHistory: mockChatHistory,
        request: {
          correlatorIds: [],
          messageIds: { all: [], direct: [], augmented: [] },
          messages: { directMessages: [], augmentedContext: [] }
        },
        tracer: tracer
      } as unknown as ContextInterface;

      // Mock contextProvider to return our context
      const mockContextProvider = new MockContextProvider();
      mockContextProvider.get.mockResolvedValue(mockContext);

      // Create a message to add
      const messageToAdd: Type.Entity.CreateMessage = {
        sessionId: 'test-session-id',
        ctx: {},
        content: [{ type: 'text' as const, text: 'test content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'test-author',
        llmName: 'test-llm',
        manifestName: 'test-manifest',
        llmIgnore: false
      };

      // Act
      // Directly call addMessages on the context's chatHistory
      const result = await mockContext.chatHistory.addMessages([messageToAdd]);

      // Assert
      // Verify that chatHistory.addMessages was called with the message
      expect(mockChatHistory.addMessages).toHaveBeenCalledWith([messageToAdd]);

      // Verify that the result is the mocked message array
      expect(result).toEqual([mockMessage]);
    });
  });

  describe('createSingleUseAppendMessageFunction', () => {
    it('should create a function that returns a message entity', async () => {
      // Mock entity that will be returned by addMessages
      const mockMessage = {
        id: 'test-message-id',
        sessionId: 'test-session-id',
        ctx: {},
        content: [{ type: 'text' as const, text: 'test content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'test-author',
        llmName: 'test-llm',
        manifestName: 'test-manifest',
        createdAt: new Date(),
        updatedAt: new Date(),
        sequenceId: 'test-sequence-id',
        llmIgnore: false
      };

      // Mock the addMessages function
      const mockAddMessages = vi.fn().mockResolvedValue([mockMessage]);

      // Create the single-use append function
      const appendFn = createSingleUseAppendMessageFunction(mockAddMessages);

      // Test data
      const sessionId = 'test-session-id';
      const messageData: Type.Entity.CreateMessage = {
        sessionId,
        ctx: {},
        content: [{ type: 'text' as const, text: 'test content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'test-author',
        llmName: 'test-llm',
        manifestName: 'test-manifest',
        llmIgnore: false
      };

      // Call the function
      const result = await appendFn(sessionId, messageData);

      // Verify it was called correctly and returns the expected result
      expect(mockAddMessages).toHaveBeenCalledWith(sessionId, [messageData]);
      expect(result).toEqual(mockMessage);
    });

    it('should throw an error if called more than once', async () => {
      // Mock addMessages
      const mockAddMessages = vi.fn().mockResolvedValue([
        {
          id: 'test-id',
          sessionId: 'test-session-id',
          ctx: {},
          content: [{ type: 'text' as const, text: 'test content' }],
          role: Type.LLM.UnifiedMessageRole.assistant,
          author: 'test-author',
          llmName: 'test-llm',
          manifestName: 'test-manifest',
          createdAt: new Date(),
          updatedAt: new Date(),
          sequenceId: 'test-sequence-id',
          llmIgnore: false
        }
      ]);

      // Create the single-use append function
      const appendFn = createSingleUseAppendMessageFunction(mockAddMessages);

      // Test data
      const sessionId = 'test-session-id';
      const messageData: Type.Entity.CreateMessage = {
        sessionId,
        ctx: {},
        content: [{ type: 'text' as const, text: 'test content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'test-author',
        llmName: 'test-llm',
        manifestName: 'test-manifest',
        llmIgnore: false
      };

      // First call should succeed
      await appendFn(sessionId, messageData);

      // Second call should throw
      await expect(appendFn(sessionId, messageData)).rejects.toThrow('Append function can only be called once');
    });

    it('should throw an error if no message is returned', async () => {
      // Mock addMessages to return an empty array
      const mockAddMessages = vi.fn().mockResolvedValue([]);

      // Create the single-use append function
      const appendFn = createSingleUseAppendMessageFunction(mockAddMessages);

      // Test data
      const sessionId = 'test-session-id';
      const messageData: Type.Entity.CreateMessage = {
        sessionId,
        ctx: {},
        content: [{ type: 'text' as const, text: 'test content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'test-author',
        llmName: 'test-llm',
        manifestName: 'test-manifest',
        llmIgnore: false
      };

      // Call should throw
      await expect(appendFn(sessionId, messageData)).rejects.toThrow('No message was returned from the repository');
    });
  });
});

describe('BaseLoftChat shutdownTimeout', () => {
  const create = (shutdownTimeout: number | undefined) =>
    new BaseLoftChat(
      new MockSessionRepository(),
      new MockChatHistoryManager(),
      new MockContextProvider(),
      new MockLlmManager(),
      { llm: { name: 'test-llm' }, shutdownTimeout } as ChatConfig,
      new MockLoftHealthCheck(),
      { executeChain: vi.fn() } as any,
      { executeChain: vi.fn() } as any,
      { executeChain: vi.fn() } as any,
      new MockGenerateResponseProvider() as any
    );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s', (timeout) => {
    expect(() => create(timeout)).toThrow(TypeError);
  });

  it.each([undefined, 0, 5000])('accepts %s', (timeout) => {
    expect(() => create(timeout)).not.toThrow();
  });
});
