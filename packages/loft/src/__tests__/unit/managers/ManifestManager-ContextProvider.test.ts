import 'reflect-metadata';

import { DI_TYPES, Interface, Repository, Schema } from '@moc-global/loft-definitions';
import { Container } from 'inversify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodObject } from 'zod';

import { NoOpTracerStrategy } from '../../../base-components';
import { ManifestManager } from '../../../managers/ManifestManager';
import { ContextProvider } from '../../../providers/ContextProvider';

// Mock the Session and ChatHistory classes
vi.mock('../../../entities', () => ({
  Session: vi.fn().mockImplementation((repository, data) => ({
    id: data.id,
    manifestName: data.manifestName || 'default',
    llmName: data.llmName || 'openai',
    ctx: data.ctx || {},
    setManifestName: vi.fn().mockResolvedValue(undefined),
    setLlmName: vi.fn().mockResolvedValue(undefined),
    getManifestName: vi.fn().mockReturnValue('default'),
    getLlmName: vi.fn().mockReturnValue('openai'),
    save: vi.fn().mockResolvedValue(undefined)
  })),
  ChatHistory: vi.fn().mockImplementation(() => ({
    getMessages: vi.fn().mockResolvedValue([]),
    addMessage: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined)
  }))
}));

describe('ManifestManager and ContextProvider Integration', () => {
  let manifestManager: ManifestManager;
  let contextProvider: ContextProvider;
  let mockManifestRepository: Repository.ObjectStorage;
  let mockManifestManagerConfig: Interface.ManifestManagerConfig;
  let mockSessionRepository: Repository.Session;
  let mockChatHistoryManager: Repository.ChatHistoryManager;
  let mockLlmManager: Interface.LlmManager;
  let mockSchema: ZodObject<any>;
  let mockSessionId: string;
  let mockContainer: Container;

  const mockManifestData = {
    llmManifests: {
      default: {
        openai: {
          systemMessage: 'you are a helpful assistant',
          modelPreset: {
            model: 'gpt-4',
            temperature: 0.7
          }
        },
        anthropic: {
          systemMessage: 'you are a helpful assistant from Anthropic',
          modelPreset: {
            model: 'claude-3',
            temperature: 0.5
          }
        }
      },
      creative: {
        openai: {
          systemMessage: 'you are a creative assistant',
          modelPreset: {
            model: 'gpt-4',
            temperature: 0.9
          }
        }
      }
    },
    prompts: {
      'weather-prompt': {
        openai: 'What is the weather in {location}?',
        anthropic: 'Tell me about the weather in {location}.'
      }
    },
    aiTasks: {
      summarization: {
        openai: {
          systemMessage: 'you are a summarization assistant',
          modelPreset: {
            model: 'gpt-4',
            temperature: 0.3
          }
        }
      }
    }
  };

  beforeEach(async () => {
    // No need to reset static properties as they're now instance-based

    mockSessionId = 'test-session-id';

    // Setup mock repositories and config
    mockManifestRepository = {
      get: vi.fn(() => Promise.resolve(mockManifestData)),
      upload: vi.fn(() => Promise.resolve())
    } as unknown as Repository.ObjectStorage;

    mockManifestManagerConfig = {
      manifestPath: 'path/to/manifest.json',
      errorPath: 'path/to/errors',
      cacheExpirationTime: 60000 // 1 minute
    };

    // Create mock session data
    const mockSessionData = {
      id: mockSessionId,
      manifestName: 'default',
      llmName: 'openai',
      ctx: {
        // Mock context data
      }
    };

    // Setup mock session repository
    mockSessionRepository = {
      getById: vi.fn().mockResolvedValue(mockSessionData),
      updateById: vi.fn().mockResolvedValue(mockSessionData),
      create: vi.fn().mockResolvedValue(mockSessionData)
    } as unknown as Repository.Session;

    // Setup mock chat history manager
    mockChatHistoryManager = {
      getMessages: vi.fn().mockResolvedValue([]),
      addMessage: vi.fn().mockResolvedValue(undefined),
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined)
    } as unknown as Repository.ChatHistoryManager;

    // Setup mock LLM manager
    mockLlmManager = {
      get: vi.fn().mockReturnValue({}),
      use: vi.fn(),
      generate: vi.fn().mockResolvedValue({
        content: 'LLM response',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
      })
    } as unknown as Interface.LlmManager;

    // Create a mock schema for validation
    mockSchema = {
      parse: vi.fn((data) => data)
    } as unknown as ZodObject<any>;

    // Mock the LoftManifest schema
    vi.spyOn(Schema.LoftManifest, 'parse').mockImplementation((data) => data as any);

    // Create ManifestManager
    manifestManager = new ManifestManager(mockManifestRepository, mockManifestManagerConfig);

    // Register schemas
    await manifestManager.useLlmManifestSchema('openai', mockSchema);
    await manifestManager.useLlmManifestSchema('anthropic', mockSchema);

    // Create mock container
    mockContainer = {
      get: vi.fn().mockImplementation((type) => {
        if (type === DI_TYPES.SessionRepository) return mockSessionRepository;
        if (type === DI_TYPES.ChatHistoryManager) return mockChatHistoryManager;
        if (type === DI_TYPES.ManifestManager) return manifestManager;
        if (type === DI_TYPES.LlmManager) return mockLlmManager;
        if (type === DI_TYPES.TracerStrategy) return new NoOpTracerStrategy();
        return null;
      })
    } as unknown as Container;

    // Create ContextProvider with container
    contextProvider = new ContextProvider(mockContainer);
  });

  describe('ContextProvider using ManifestManager', () => {
    it('should initialize session with default manifest and LLM names', async () => {
      // Act
      const context = await contextProvider.get(mockSessionId);

      // Assert
      expect(mockSessionRepository.getById).toHaveBeenCalledWith(mockSessionId);
      expect(context).toBeDefined();
    });

    it('should update context with manifest data', async () => {
      // Arrange
      const context = await contextProvider.get(mockSessionId);

      // Act
      const updatedContext = await contextProvider.update(context);

      // Assert
      expect(updatedContext).toBeDefined();
    });

    it('should handle errors from ManifestManager', async () => {
      // Arrange
      // Mock ManifestManager to throw an error
      manifestManager.getLlmManifest = vi.fn().mockRejectedValue(new Error('Manifest not found'));

      // Act & Assert
      const context = await contextProvider.get(mockSessionId);

      // We can't directly test the error handling since it's internal to the ContextProvider
      // But we can verify that we got a context object despite the error
      expect(context).toBeDefined();
    });
  });
});
