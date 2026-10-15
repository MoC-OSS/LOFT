import 'reflect-metadata';

import {
  Agent,
  Chat,
  ContextInterface,
  ContextProviderInterface,
  DI_TYPES,
  Interface,
  Repository,
  Schema,
  Type
} from '@moc-global/loft-definitions';
import { configureSpyLoggerStrategy } from '@moc-global/loft-test-suite';
import { Container } from 'inversify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NoOpTracerStrategy } from '../../../../../base-components';
import { FocusRegistry } from '../../../../../focus/FocusRegistry';
import { LoftHealthCheckInterface } from '../../../../../LoftHealthCheck';
import {
  GenerateResultMessagesProvider,
  GenerateResultMessagesProviderInterface
} from '../../../../../providers/GenerateResultMessagesProvider';
import { ChatConfig } from '../../../../../types';
import { BaseLoftChat } from '../../../../../workflows/chat/BaseLoftChat';

configureSpyLoggerStrategy();

// --- Mock implementations ---

class MockContextProvider implements ContextProviderInterface {
  get = vi.fn();
  update = vi.fn();
  lock = vi.fn();
  unlock = vi.fn();
}

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

// --- Helpers ---

const testFocus: Agent.Focus = {
  agentName: 'intake',
  prompt: 'Collect vehicle info',
  fields: [
    { key: 'vehicleType', type: Agent.FocusFieldType.STRING, required: true, description: 'Vehicle type' },
    { key: 'year', type: Agent.FocusFieldType.NUMBER, required: true, description: 'Model year' }
  ],
  onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'validator' }
};

function createMockContext(
  sessionId = 'test-session-id',
  sessionOverrides?: Record<string, unknown>
): ContextInterface {
  const tracerStrategy = new NoOpTracerStrategy();
  const tracer = tracerStrategy.createTracer({ traceId: 'test-trace-id', name: 'test-tracer', sessionId });

  return {
    sessionId,
    session: { id: sessionId, currentLlmName: 'test-llm', currentManifestName: 'test-manifest', ...sessionOverrides },
    request: {
      correlatorIds: ['correlator-1'],
      messageIds: { all: ['message-1'], direct: ['message-1'], augmented: [] },
      messages: {
        directMessages: [
          {
            sessionId,
            ctx: {},
            content: [{ type: 'text' as const, text: 'test message' }],
            role: Type.LLM.UnifiedMessageRole.user,
            author: 'user',
            llmName: 'test-llm',
            manifestName: 'test-manifest',
            llmIgnore: false
          }
        ],
        augmentedContext: []
      }
    },
    chatHistory: {
      messages: [
        {
          id: 'test-id',
          sessionId,
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
        }
      ]
    },
    tracer
  } as unknown as ContextInterface;
}

function createMockLlmResponse() {
  const topChoice = {
    content: [{ type: 'text' as const, text: 'test response' }],
    role: Type.LLM.UnifiedMessageRole.assistant,
    setAppendFn: vi.fn()
  };
  return { choices: [topChoice], setAppendFn: vi.fn(), topChoice };
}

describe('BaseLoftChat — Focus integration', () => {
  let container: Container;
  let baseLoftChat: BaseLoftChat;
  let mockContextProvider: MockContextProvider;
  let mockLlmManager: MockLlmManager;
  let focusRegistry: FocusRegistry;
  let mockSessionRepository: MockSessionRepository;
  let mockInputMiddlewareManager: any;
  let mockBeforeGenerateMiddlewareManager: any;
  let mockAfterGenerateMiddlewareManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doUnmock('@moc-global/loft-definitions');

    vi.spyOn(Schema.Entity.CreateMessage, 'array').mockReturnValue({
      safeParse: (data: Type.Entity.CreateMessage[]) => ({ success: true, data })
    } as any);

    mockSessionRepository = new MockSessionRepository();
    mockContextProvider = new MockContextProvider();
    mockLlmManager = new MockLlmManager();
    focusRegistry = new FocusRegistry();

    mockInputMiddlewareManager = {
      executeChain: vi.fn().mockResolvedValue({ payload: { directMessages: [], augmentedContext: [] } })
    };
    mockBeforeGenerateMiddlewareManager = {
      executeChain: vi.fn().mockResolvedValue({ payload: { directMessages: [], augmentedContext: [] } })
    };
    mockAfterGenerateMiddlewareManager = {
      executeChain: vi.fn().mockResolvedValue({ payload: { directMessages: [], augmentedContext: [] } })
    };

    container = new Container();
    container.bind<Repository.Session>(DI_TYPES.SessionRepository).toConstantValue(mockSessionRepository as any);
    container
      .bind<Repository.ChatHistoryManager>(DI_TYPES.ChatHistoryManager)
      .toConstantValue(new MockChatHistoryManager() as any);
    container.bind<ContextProviderInterface>(DI_TYPES.ContextProvider).toConstantValue(mockContextProvider);
    container.bind<Interface.LlmManager>(DI_TYPES.LlmManager).toConstantValue(mockLlmManager);
    container.bind<ChatConfig>(DI_TYPES.ChatConfig).toConstantValue({});
    container.bind<LoftHealthCheckInterface>(DI_TYPES.LoftHealthCheck).toConstantValue({ check: vi.fn() } as any);
    container.bind(DI_TYPES.InputMiddleware).toConstantValue(mockInputMiddlewareManager);
    container.bind(DI_TYPES.BeforeGenerateMiddlewareManager).toConstantValue(mockBeforeGenerateMiddlewareManager);
    container.bind(DI_TYPES.AfterGenerateMiddlewareManager).toConstantValue(mockAfterGenerateMiddlewareManager);
    container
      .bind<GenerateResultMessagesProviderInterface>(DI_TYPES.GenerateResultMessagesProvider)
      .to(GenerateResultMessagesProvider);
    container.bind<FocusRegistry>(DI_TYPES.FocusRegistry).toConstantValue(focusRegistry);
    container.bind<BaseLoftChat>(BaseLoftChat).toSelf();

    baseLoftChat = container.get<BaseLoftChat>(BaseLoftChat);
  });

  function setupGenerateMocks(sessionOverrides?: Record<string, unknown>) {
    const mockContext = createMockContext('test-session-id', sessionOverrides);
    const mockLlmResponse = createMockLlmResponse();

    mockContextProvider.get.mockResolvedValue(mockContext);
    mockContextProvider.update.mockResolvedValue(mockContext);
    mockLlmManager.generate.mockResolvedValue(mockLlmResponse);
    afterGenerateMiddlewareReturnsLlmResponse(mockLlmResponse);

    return { mockContext, mockLlmResponse };
  }

  function afterGenerateMiddlewareReturnsLlmResponse(mockLlmResponse: any) {
    mockAfterGenerateMiddlewareManager.executeChain.mockResolvedValue({
      payload: {
        directMessages: [],
        augmentedContext: [],
        llmResponse: mockLlmResponse
      }
    });
  }

  function createDirectMessage(text = 'Hi') {
    return {
      sessionId: 'test-session-id',
      ctx: {},
      content: [{ type: 'text' as const, text }],
      role: Type.LLM.UnifiedMessageRole.user,
      author: 'user',
      llmName: 'test-llm',
      manifestName: 'test-manifest',
      llmIgnore: false
    } as Type.Entity.CreateMessage;
  }

  it('should inject focus prompt and tools when focusAgent is provided', async () => {
    focusRegistry.register('intake', testFocus);
    const mockFocusStore: Agent.FocusStateStore = {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      getAll: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      clearAll: vi.fn().mockResolvedValue(undefined)
    };
    (mockSessionRepository as any).focus = mockFocusStore;

    setupGenerateMocks();

    const result = await baseLoftChat.generate({
      sessionId: 'test-session-id',
      directMessages: [createDirectMessage()],
      focusAgent: 'intake'
    });

    // Verify focus tools were passed to LLM manager
    const generateCall = mockLlmManager.generate.mock.calls[0];
    const additionalTools = generateCall[4]; // 5th argument
    expect(additionalTools).toBeDefined();
    expect(additionalTools.length).toBe(3); // update, confirm, classify
    expect(additionalTools[0].definition.name).toBe('update_intake_focus');
    expect(additionalTools[1].definition.name).toBe('confirm_intake_focus');
    expect(additionalTools[2].definition.name).toBe('classify_intake_focus');

    // Verify focusStatus is returned
    expect(result.focusStatus).toBeDefined();
    expect(result.focusStatus!.agentName).toBe('intake');
    expect(result.focusStatus!.ready).toBe(false);
    expect(result.focusStatus!.missing).toContain('vehicleType');
    expect(result.focusStatus!.missing).toContain('year');
  });

  it('should return focusStatus with ready=true when all fields are filled', async () => {
    focusRegistry.register('intake', testFocus);
    const mockFocusStore: Agent.FocusStateStore = {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      getAll: vi.fn().mockResolvedValue({ vehicleType: 'car', year: 2020 }),
      delete: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      clearAll: vi.fn().mockResolvedValue(undefined)
    };
    (mockSessionRepository as any).focus = mockFocusStore;

    setupGenerateMocks();

    const result = await baseLoftChat.generate({
      sessionId: 'test-session-id',
      directMessages: [createDirectMessage('Done')],
      focusAgent: 'intake'
    });

    expect(result.focusStatus).toBeDefined();
    expect(result.focusStatus!.ready).toBe(true);
    expect(result.focusStatus!.filled).toEqual({ vehicleType: 'car', year: 2020 });
    expect(result.focusStatus!.missing).toEqual([]);
  });

  it('should not run focus logic when focusAgent is not provided', async () => {
    focusRegistry.register('intake', testFocus);

    setupGenerateMocks();

    const result = await baseLoftChat.generate({
      sessionId: 'test-session-id',
      directMessages: [createDirectMessage()]
    });

    // No focus tools should be passed
    const generateCall = mockLlmManager.generate.mock.calls[0];
    const additionalTools = generateCall[4];
    expect(additionalTools).toBeUndefined();

    // focusStatus should be undefined
    expect(result.focusStatus).toBeUndefined();
  });

  it('should throw when focusAgent references unregistered name', async () => {
    setupGenerateMocks();

    await expect(
      baseLoftChat.generate({
        sessionId: 'test-session-id',
        directMessages: [createDirectMessage()],
        focusAgent: 'nonexistent'
      })
    ).rejects.toThrow(/Focus "nonexistent" is not registered/);
  });

  it('should merge focus tools with existing additionalTools', async () => {
    focusRegistry.register('intake', testFocus);
    const mockFocusStore: Agent.FocusStateStore = {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      getAll: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      clearAll: vi.fn().mockResolvedValue(undefined)
    };
    (mockSessionRepository as any).focus = mockFocusStore;

    setupGenerateMocks();

    const customTool: Chat.AdditionalTool = {
      definition: {
        name: 'custom_tool',
        description: 'A custom tool',
        inputSchema: { type: Chat.AdditionalToolSchemaType.OBJECT }
      },
      handler: vi.fn().mockResolvedValue({ content: [{ type: Chat.AdditionalToolContentType.TEXT, text: 'ok' }] })
    };

    await baseLoftChat.generate({
      sessionId: 'test-session-id',
      directMessages: [createDirectMessage()],
      additionalTools: [customTool],
      focusAgent: 'intake'
    });

    const generateCall = mockLlmManager.generate.mock.calls[0];
    const additionalTools = generateCall[4];
    expect(additionalTools).toBeDefined();
    expect(additionalTools.length).toBe(4); // 1 custom + 3 focus
    expect(additionalTools[0].definition.name).toBe('custom_tool');
    expect(additionalTools[1].definition.name).toBe('update_intake_focus');
  });

  it('should fall back to InMemoryFocusStateStore when session repo has no focus', async () => {
    focusRegistry.register('intake', testFocus);

    setupGenerateMocks();

    const result = await baseLoftChat.generate({
      sessionId: 'test-session-id',
      directMessages: [createDirectMessage()],
      focusAgent: 'intake'
    });

    expect(result.focusStatus).toBeDefined();
    expect(result.focusStatus!.agentName).toBe('intake');
  });

  describe('Session-level Focus binding', () => {
    it('should resolve focusAgent from session when not provided per-call', async () => {
      focusRegistry.register('intake', testFocus);
      const mockFocusStore: Agent.FocusStateStore = {
        get: vi.fn().mockResolvedValue(undefined),
        set: vi.fn().mockResolvedValue(undefined),
        getAll: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
        clearAll: vi.fn().mockResolvedValue(undefined)
      };
      (mockSessionRepository as any).focus = mockFocusStore;

      // Session has focusAgent set
      setupGenerateMocks({ focusAgent: 'intake' });

      const result = await baseLoftChat.generate({
        sessionId: 'test-session-id',
        directMessages: [createDirectMessage()]
        // no focusAgent in options — should read from session
      });

      // Focus should activate from session
      const generateCall = mockLlmManager.generate.mock.calls[0];
      const additionalTools = generateCall[4];
      expect(additionalTools).toBeDefined();
      expect(additionalTools.length).toBe(3);
      expect(result.focusStatus).toBeDefined();
      expect(result.focusStatus!.agentName).toBe('intake');
    });

    it('should allow per-call focusAgent to override session-level binding', async () => {
      const otherFocus: Agent.Focus = {
        agentName: 'payment',
        prompt: 'Collect payment info',
        fields: [{ key: 'amount', type: Agent.FocusFieldType.NUMBER, required: true, description: 'Amount' }],
        onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'confirm' }
      };
      focusRegistry.register('intake', testFocus);
      focusRegistry.register('payment', otherFocus);
      const mockFocusStore: Agent.FocusStateStore = {
        get: vi.fn().mockResolvedValue(undefined),
        set: vi.fn().mockResolvedValue(undefined),
        getAll: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
        clearAll: vi.fn().mockResolvedValue(undefined)
      };
      (mockSessionRepository as any).focus = mockFocusStore;

      // Session says 'intake', but per-call says 'payment'
      setupGenerateMocks({ focusAgent: 'intake' });

      const result = await baseLoftChat.generate({
        sessionId: 'test-session-id',
        directMessages: [createDirectMessage()],
        focusAgent: 'payment' // override
      });

      expect(result.focusStatus).toBeDefined();
      expect(result.focusStatus!.agentName).toBe('payment');
    });

    it('should disable Focus when options.focusAgent is null — even if session has one', async () => {
      focusRegistry.register('intake', testFocus);

      // Session has focusAgent, but per-call explicitly disables it
      setupGenerateMocks({ focusAgent: 'intake' });

      const result = await baseLoftChat.generate({
        sessionId: 'test-session-id',
        directMessages: [createDirectMessage()],
        focusAgent: null // explicitly disable
      });

      // No focus should run
      const generateCall = mockLlmManager.generate.mock.calls[0];
      const additionalTools = generateCall[4];
      expect(additionalTools).toBeUndefined();
      expect(result.focusStatus).toBeUndefined();
    });

    it('should auto-deactivate session Focus when focusStatus.ready is true', async () => {
      focusRegistry.register('intake', testFocus);
      const mockFocusStore: Agent.FocusStateStore = {
        get: vi.fn().mockResolvedValue(undefined),
        set: vi.fn().mockResolvedValue(undefined),
        getAll: vi.fn().mockResolvedValue({ vehicleType: 'car', year: 2020 }),
        delete: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
        clearAll: vi.fn().mockResolvedValue(undefined)
      };
      (mockSessionRepository as any).focus = mockFocusStore;
      mockSessionRepository.updateById.mockResolvedValue(undefined);

      // Session has focusAgent — should be cleared after completion
      setupGenerateMocks({ focusAgent: 'intake' });

      const result = await baseLoftChat.generate({
        sessionId: 'test-session-id',
        directMessages: [createDirectMessage()]
      });

      expect(result.focusStatus!.ready).toBe(true);

      // Verify session was updated to clear focusAgent
      expect(mockSessionRepository.updateById).toHaveBeenCalledWith('test-session-id', { focusAgent: null });
    });

    it('should clear the collected values once the Focus completes and still return them', async () => {
      focusRegistry.register('intake', testFocus);
      const mockFocusStore: Agent.FocusStateStore = {
        get: vi.fn().mockResolvedValue(undefined),
        set: vi.fn().mockResolvedValue(undefined),
        getAll: vi.fn().mockResolvedValue({ vehicleType: 'car', year: 2020 }),
        delete: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
        clearAll: vi.fn().mockResolvedValue(undefined)
      };
      (mockSessionRepository as unknown as { focus: Agent.FocusStateStore }).focus = mockFocusStore;
      setupGenerateMocks();

      const result = await baseLoftChat.generate({
        sessionId: 'test-session-id',
        directMessages: [createDirectMessage()],
        focusAgent: 'intake'
      });

      expect(result.focusStatus).toMatchObject({ ready: true, filled: { vehicleType: 'car', year: 2020 } });
      expect(mockFocusStore.clear).toHaveBeenCalledWith('test-session-id', testFocus.agentName);
    });

    it('should keep the collected values while the Focus is incomplete', async () => {
      focusRegistry.register('intake', testFocus);
      const mockFocusStore: Agent.FocusStateStore = {
        get: vi.fn().mockResolvedValue(undefined),
        set: vi.fn().mockResolvedValue(undefined),
        getAll: vi.fn().mockResolvedValue({ vehicleType: 'car' }),
        delete: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
        clearAll: vi.fn().mockResolvedValue(undefined)
      };
      (mockSessionRepository as unknown as { focus: Agent.FocusStateStore }).focus = mockFocusStore;
      setupGenerateMocks();

      const result = await baseLoftChat.generate({
        sessionId: 'test-session-id',
        directMessages: [createDirectMessage()],
        focusAgent: 'intake'
      });

      expect(result.focusStatus!.ready).toBe(false);
      expect(mockFocusStore.clear).not.toHaveBeenCalled();
    });

    it('should not deactivate the session Focus when a different per-call Focus completes', async () => {
      focusRegistry.register('intake', testFocus);
      focusRegistry.register('other', { ...testFocus, agentName: 'other' });
      const mockFocusStore: Agent.FocusStateStore = {
        get: vi.fn().mockResolvedValue(undefined),
        set: vi.fn().mockResolvedValue(undefined),
        getAll: vi.fn().mockResolvedValue({ vehicleType: 'car', year: 2020 }),
        delete: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
        clearAll: vi.fn().mockResolvedValue(undefined)
      };
      (mockSessionRepository as unknown as { focus: Agent.FocusStateStore }).focus = mockFocusStore;

      // The session collects 'intake'; this call runs 'other'
      setupGenerateMocks({ focusAgent: 'intake' });

      const result = await baseLoftChat.generate({
        sessionId: 'test-session-id',
        directMessages: [createDirectMessage()],
        focusAgent: 'other'
      });

      expect(result.focusStatus!.ready).toBe(true);
      expect(mockSessionRepository.updateById).not.toHaveBeenCalled();
    });

    it('should not auto-deactivate when Focus is provided per-call (not session-level)', async () => {
      focusRegistry.register('intake', testFocus);
      const mockFocusStore: Agent.FocusStateStore = {
        get: vi.fn().mockResolvedValue(undefined),
        set: vi.fn().mockResolvedValue(undefined),
        getAll: vi.fn().mockResolvedValue({ vehicleType: 'car', year: 2020 }),
        delete: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
        clearAll: vi.fn().mockResolvedValue(undefined)
      };
      (mockSessionRepository as any).focus = mockFocusStore;

      // Session has NO focusAgent — Focus is per-call only
      setupGenerateMocks();

      const result = await baseLoftChat.generate({
        sessionId: 'test-session-id',
        directMessages: [createDirectMessage()],
        focusAgent: 'intake' // per-call, not session-level
      });

      expect(result.focusStatus!.ready).toBe(true);

      // Should NOT call updateById — no session-level Focus to deactivate
      expect(mockSessionRepository.updateById).not.toHaveBeenCalled();
    });

    it('should have zero overhead when neither options nor session specify focusAgent', async () => {
      focusRegistry.register('intake', testFocus);

      // Session has no focusAgent
      setupGenerateMocks();

      const result = await baseLoftChat.generate({
        sessionId: 'test-session-id',
        directMessages: [createDirectMessage()]
      });

      const generateCall = mockLlmManager.generate.mock.calls[0];
      const additionalTools = generateCall[4];
      expect(additionalTools).toBeUndefined();
      expect(result.focusStatus).toBeUndefined();
    });
  });

  describe('resolveFields — dynamic field resolution', () => {
    function createFocusStore(stored: Record<string, unknown> = {}): Agent.FocusStateStore {
      return {
        get: vi.fn().mockImplementation((_sid: string, _agent: string, key: string) => Promise.resolve(stored[key])),
        set: vi.fn().mockResolvedValue(undefined),
        getAll: vi.fn().mockResolvedValue(stored),
        delete: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
        clearAll: vi.fn().mockResolvedValue(undefined)
      };
    }

    const dynamicFocus: Agent.Focus = {
      agentName: 'form',
      prompt: 'Collect info',
      fields: [
        {
          key: 'marital_status',
          type: Agent.FocusFieldType.ENUM,
          required: true,
          values: ['single', 'married'],
          description: 'Marital status'
        },
        { key: 'spouse_name', type: Agent.FocusFieldType.STRING, required: true, description: 'Spouse name' },
        { key: 'spouse_age', type: Agent.FocusFieldType.NUMBER, required: true, description: 'Spouse age' }
      ],
      resolveFields: ({ fields, filled }) => {
        if (filled.marital_status === 'single') {
          return fields.filter((f) => !f.key.startsWith('spouse_'));
        }
        return fields;
      },
      onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'next' }
    };

    it('should exclude fields removed by resolveFields from focusStatus.missing', async () => {
      const store = createFocusStore({ marital_status: 'single' });
      (mockSessionRepository as any).focus = store;
      focusRegistry.register('form', dynamicFocus);

      setupGenerateMocks();

      const result = await baseLoftChat.generate({
        sessionId: 'test-session-id',
        directMessages: [createDirectMessage()],
        focusAgent: 'form'
      });

      expect(result.focusStatus).toBeDefined();
      expect(result.focusStatus!.missing).not.toContain('spouse_name');
      expect(result.focusStatus!.missing).not.toContain('spouse_age');
      expect(result.focusStatus!.ready).toBe(true);
    });

    it('should include fields added by resolveFields in focusStatus.missing', async () => {
      const addFieldsFocus: Agent.Focus = {
        agentName: 'add-form',
        prompt: 'Collect info',
        fields: [
          { key: 'has_children', type: Agent.FocusFieldType.BOOLEAN, required: true, description: 'Has children?' }
        ],
        resolveFields: ({ fields, filled }) => {
          if (filled.has_children === true) {
            return [
              ...fields,
              {
                key: 'children_count',
                type: Agent.FocusFieldType.NUMBER,
                required: true,
                description: 'Number of children'
              }
            ];
          }
          return fields;
        },
        onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'next' }
      };

      const store = createFocusStore({ has_children: true });
      (mockSessionRepository as any).focus = store;
      focusRegistry.register('add-form', addFieldsFocus);

      setupGenerateMocks();

      const result = await baseLoftChat.generate({
        sessionId: 'test-session-id',
        directMessages: [createDirectMessage()],
        focusAgent: 'add-form'
      });

      expect(result.focusStatus!.missing).toContain('children_count');
      expect(result.focusStatus!.ready).toBe(false);
    });

    it('should behave identically when resolveFields is not defined (backward compat)', async () => {
      const store = createFocusStore({});
      (mockSessionRepository as any).focus = store;
      focusRegistry.register('intake', testFocus);

      setupGenerateMocks();

      const result = await baseLoftChat.generate({
        sessionId: 'test-session-id',
        directMessages: [createDirectMessage()],
        focusAgent: 'intake'
      });

      expect(result.focusStatus).toBeDefined();
      expect(result.focusStatus!.missing).toContain('vehicleType');
      expect(result.focusStatus!.missing).toContain('year');
      expect(result.focusStatus!.ready).toBe(false);
    });

    it('should return ready=true when resolveFields returns empty array', async () => {
      const emptyFocus: Agent.Focus = {
        agentName: 'empty',
        prompt: 'Nothing to collect',
        fields: [{ key: 'something', type: Agent.FocusFieldType.STRING, required: true, description: 'Something' }],
        resolveFields: () => [],
        onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'next' }
      };

      const store = createFocusStore({});
      (mockSessionRepository as any).focus = store;
      focusRegistry.register('empty', emptyFocus);

      setupGenerateMocks();

      const result = await baseLoftChat.generate({
        sessionId: 'test-session-id',
        directMessages: [createDirectMessage()],
        focusAgent: 'empty'
      });

      expect(result.focusStatus!.ready).toBe(true);
      expect(result.focusStatus!.missing).toEqual([]);
    });

    it('should preserve stored values of fields removed by resolveFields', async () => {
      const store = createFocusStore({ marital_status: 'single', spouse_name: 'Alice' });
      (mockSessionRepository as any).focus = store;
      focusRegistry.register('form', dynamicFocus);

      setupGenerateMocks();

      const result = await baseLoftChat.generate({
        sessionId: 'test-session-id',
        directMessages: [createDirectMessage()],
        focusAgent: 'form'
      });

      // spouse_name should not appear in filled (field is removed) but store still has it
      expect(result.focusStatus!.filled).not.toHaveProperty('spouse_name');
      expect(store.delete).not.toHaveBeenCalled();

      // The store getAll still returns spouse_name — it was not deleted
      const allValues = await store.getAll('test-session-id', 'form');
      expect(allValues).toHaveProperty('spouse_name', 'Alice');
    });

    it('should re-resolve fields in post-generate status with fresh filled values', async () => {
      const resolveFieldsSpy = vi.fn(({ fields, filled }: Agent.ResolveFieldsContext) => {
        if (filled.marital_status === 'single') {
          return fields.filter((f) => !f.key.startsWith('spouse_'));
        }
        return fields;
      });

      const reResolveFocus: Agent.Focus = {
        ...dynamicFocus,
        resolveFields: resolveFieldsSpy
      };

      // Pre-generate: marital_status not filled yet
      const preGenStore = createFocusStore({});
      (mockSessionRepository as any).focus = preGenStore;
      focusRegistry.register('form', reResolveFocus);

      // After LLM response, simulate that the store now has marital_status = 'single'
      // (update tool was called during generation)
      let callCount = 0;
      preGenStore.getAll = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) return Promise.resolve({});
        return Promise.resolve({ marital_status: 'single' });
      });

      setupGenerateMocks();

      const result = await baseLoftChat.generate({
        sessionId: 'test-session-id',
        directMessages: [createDirectMessage()],
        focusAgent: 'form'
      });

      // resolveFields called twice: pre-generate and post-generate
      expect(resolveFieldsSpy).toHaveBeenCalledTimes(2);
      // Post-generate status should reflect the updated fields (spouse removed)
      expect(result.focusStatus!.missing).not.toContain('spouse_name');
      expect(result.focusStatus!.missing).not.toContain('spouse_age');
    });

    it('should use resolved fields in tool schema — update rejects fields not in resolved set', async () => {
      const store = createFocusStore({ marital_status: 'single' });
      (mockSessionRepository as any).focus = store;
      focusRegistry.register('form', dynamicFocus);

      setupGenerateMocks();

      await baseLoftChat.generate({
        sessionId: 'test-session-id',
        directMessages: [createDirectMessage()],
        focusAgent: 'form'
      });

      // Get the update tool handler from LLM manager call
      const generateCall = mockLlmManager.generate.mock.calls[0];
      const additionalTools = generateCall[4] as Chat.AdditionalTool[];
      const updateTool = additionalTools.find((t) => t.definition.name === 'update_form_focus');
      expect(updateTool).toBeDefined();

      // Call the handler with a removed field — should be rejected
      const result = await updateTool!.handler({ spouse_name: 'Alice' });
      expect(result.content[0].text).toContain('Unknown field');
      expect(result.isError).toBe(true);

      // Verify the tool schema only has marital_status (spouse fields filtered out)
      const schema = updateTool!.definition.inputSchema;
      expect(schema.properties).toHaveProperty('marital_status');
      expect(schema.properties).not.toHaveProperty('spouse_name');
      expect(schema.properties).not.toHaveProperty('spouse_age');
    });
  });
});
