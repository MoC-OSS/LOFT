import { DI_TYPES, Repository, Type } from '@moc-global/loft-definitions';
import { Container } from 'inversify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { patchMessages } from '../../../managers/AbstractChatHistoryManager';
import { ChatHistoryManager } from '../../../managers/ChatHistoryManager';

// Define enum for MessagePatchAction
enum MessagePatchAction {
  PATCH = 'PATCH'
}

// Mock repositories
const mockChatHistoryRepository = {
  addMessages: vi.fn(),
  getMessages: vi.fn(),
  checkHealth: vi.fn(),
  end: vi.fn()
};

const mockChatHistoryPatcherRepository = {
  patchMessages: vi.fn(),
  getPatches: vi.fn(),
  checkHealth: vi.fn(),
  end: vi.fn()
};

// Helper function to create complete Message objects with all required properties
const createCompleteMessage = (
  id: string,
  role: Type.LLM.UnifiedMessageRole,
  content: Type.Entity.FullContentPart[],
  author: string
): Type.Entity.Message => ({
  id,
  sessionId: 'session-123',
  ctx: {},
  content,
  role,
  author,
  llmName: 'test-llm',
  manifestName: 'test-manifest',
  sequenceId: '1',
  llmIgnore: false,
  createdAt: new Date(),
  updatedAt: new Date()
});

// Helper function to create complete CreateMessage objects with all required properties
const createCompleteCreateMessage = (
  role: Type.LLM.UnifiedMessageRole,
  content: Type.Entity.FullContentPart[],
  author: string
): Type.Entity.CreateMessage => ({
  sessionId: 'session-123',
  ctx: {},
  content,
  role,
  author,
  llmName: 'test-llm',
  manifestName: 'test-manifest',
  llmIgnore: false
});

describe('ChatHistoryManager', () => {
  let container: Container;
  let chatHistoryManager: ChatHistoryManager;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Set up container
    container = new Container();
    container
      .bind<Repository.ChatHistory>(DI_TYPES.ChatHistoryRepository)
      .toConstantValue(mockChatHistoryRepository as unknown as Repository.ChatHistory);
    container
      .bind<Repository.ChatHistoryPatcher>(DI_TYPES.ChatHistoryPatcherRepository)
      .toConstantValue(mockChatHistoryPatcherRepository as unknown as Repository.ChatHistoryPatcher);
    container.bind<ChatHistoryManager>(ChatHistoryManager).toSelf();

    // Get instance
    chatHistoryManager = container.get<ChatHistoryManager>(ChatHistoryManager);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with both repositories', () => {
      // Assert
      expect(chatHistoryManager['chatHistoryRepository']).toBe(mockChatHistoryRepository);
      expect(chatHistoryManager['chatHistoryPatcherRepository']).toBe(mockChatHistoryPatcherRepository);
    });

    it('should initialize without patcher repository', () => {
      // Arrange
      const containerWithoutPatcher = new Container();
      containerWithoutPatcher
        .bind<Repository.ChatHistory>(DI_TYPES.ChatHistoryRepository)
        .toConstantValue(mockChatHistoryRepository as unknown as Repository.ChatHistory);
      containerWithoutPatcher.bind<ChatHistoryManager>(ChatHistoryManager).toSelf();

      // Act
      const managerWithoutPatcher = containerWithoutPatcher.get<ChatHistoryManager>(ChatHistoryManager);

      // Assert
      expect(managerWithoutPatcher['chatHistoryRepository']).toBe(mockChatHistoryRepository);
      expect(managerWithoutPatcher['chatHistoryPatcherRepository']).toBeUndefined();
    });
  });

  describe('addMessages', () => {
    it('should call repository addMessages with correct parameters', async () => {
      // Arrange
      const sessionId = 'session-123';
      const messages: Type.Entity.CreateMessage[] = [
        createCompleteCreateMessage(
          Type.LLM.UnifiedMessageRole.user,
          [{ type: 'text' as const, text: 'Hello' }],
          'user-1'
        )
      ];
      (mockChatHistoryRepository.addMessages as any).mockResolvedValue({ id: 'history-1', messages });

      // Act
      const result = await chatHistoryManager.addMessages(sessionId, messages);

      // Assert
      expect(mockChatHistoryRepository.addMessages).toHaveBeenCalledWith(sessionId, messages);
      expect(result).toEqual({ id: 'history-1', messages });
    });

    it('should handle empty messages array', async () => {
      // Arrange
      const sessionId = 'session-123';
      const messages: Type.Entity.CreateMessage[] = [];
      (mockChatHistoryRepository.addMessages as any).mockResolvedValue({ id: 'history-1', messages: [] });

      // Act
      const result = await chatHistoryManager.addMessages(sessionId, messages);

      // Assert
      expect(mockChatHistoryRepository.addMessages).toHaveBeenCalledWith(sessionId, messages);
      expect(result).toEqual({ id: 'history-1', messages: [] });
    });

    it('should reject a message that belongs to another session', async () => {
      const messages: Type.Entity.CreateMessage[] = [
        createCompleteCreateMessage(Type.LLM.UnifiedMessageRole.user, [{ type: 'text' as const, text: 'Hi' }], 'u-1'),
        {
          ...createCompleteCreateMessage(Type.LLM.UnifiedMessageRole.user, [{ type: 'text', text: 'Hi' }], 'u-1'),
          sessionId: 'other-session'
        }
      ];

      await expect(chatHistoryManager.addMessages('session-123', messages)).rejects.toThrow(
        'Cannot add a message of session other-session to session session-123'
      );
      expect(mockChatHistoryRepository.addMessages).not.toHaveBeenCalled();
    });

    it('should propagate errors from repository', async () => {
      // Arrange
      const sessionId = 'session-123';
      const messages: Type.Entity.CreateMessage[] = [
        createCompleteCreateMessage(
          Type.LLM.UnifiedMessageRole.user,
          [{ type: 'text' as const, text: 'Hello' }],
          'user-1'
        )
      ];
      const error = new Error('Database error');
      (mockChatHistoryRepository.addMessages as any).mockRejectedValue(error);

      // Act & Assert
      await expect(chatHistoryManager.addMessages(sessionId, messages)).rejects.toThrow('Database error');
    });
  });

  describe('getMessages', () => {
    it('should return messages from repository when no patcher exists', async () => {
      // Arrange
      const containerWithoutPatcher = new Container();
      containerWithoutPatcher
        .bind<Repository.ChatHistory>(DI_TYPES.ChatHistoryRepository)
        .toConstantValue(mockChatHistoryRepository as unknown as Repository.ChatHistory);
      containerWithoutPatcher.bind<ChatHistoryManager>(ChatHistoryManager).toSelf();
      const managerWithoutPatcher = containerWithoutPatcher.get<ChatHistoryManager>(ChatHistoryManager);

      const sessionId = 'session-123';
      const messages: Type.Entity.Message[] = [
        createCompleteMessage(
          'msg-1',
          Type.LLM.UnifiedMessageRole.user,
          [{ type: 'text' as const, text: 'Hello' }],
          'user-1'
        )
      ];
      (mockChatHistoryRepository.getMessages as any).mockResolvedValue(messages);

      // Act
      const result = await managerWithoutPatcher.getMessages(sessionId);

      // Assert
      expect(mockChatHistoryRepository.getMessages).toHaveBeenCalledWith(sessionId);
      expect(result).toEqual(messages);
    });

    it('should apply patches to messages when patcher exists', async () => {
      // Arrange
      const sessionId = 'session-123';
      const messages: Type.Entity.Message[] = [
        createCompleteMessage(
          'msg-1',
          Type.LLM.UnifiedMessageRole.user,
          [{ type: 'text' as const, text: 'Hello' }],
          'user-1'
        )
      ];
      const patches: Type.Entity.MessagePatch[] = [
        {
          id: 'patch-1',
          messageId: 'msg-1',
          content: [{ type: 'text' as const, text: 'Hello updated' }],
          sequenceId: '1',
          sessionId: sessionId,
          createdAt: new Date(),
          patchAction: MessagePatchAction.PATCH
        }
      ];
      (mockChatHistoryRepository.getMessages as any).mockResolvedValue(messages);
      (mockChatHistoryPatcherRepository.getPatches as any).mockResolvedValue(patches);

      // Act
      const result = await chatHistoryManager.getMessages(sessionId);

      // Assert
      expect(mockChatHistoryRepository.getMessages).toHaveBeenCalledWith(sessionId);
      expect(mockChatHistoryPatcherRepository.getPatches).toHaveBeenCalledWith(sessionId);
      expect(result[0].content).toEqual([{ type: 'text' as const, text: 'Hello updated' }]);
    });

    it('should handle case when patcher returns no patches', async () => {
      // Arrange
      const sessionId = 'session-123';
      const messages: Type.Entity.Message[] = [
        createCompleteMessage(
          'msg-1',
          Type.LLM.UnifiedMessageRole.user,
          [{ type: 'text' as const, text: 'Hello' }],
          'user-1'
        )
      ];
      (mockChatHistoryRepository.getMessages as any).mockResolvedValue(messages);
      (mockChatHistoryPatcherRepository.getPatches as any).mockResolvedValue([]);

      // Act
      const result = await chatHistoryManager.getMessages(sessionId);

      // Assert
      expect(mockChatHistoryRepository.getMessages).toHaveBeenCalledWith(sessionId);
      expect(mockChatHistoryPatcherRepository.getPatches).toHaveBeenCalledWith(sessionId);
      expect(result).toEqual(messages);
    });

    it('should handle case when patcher returns undefined', async () => {
      // Arrange
      const sessionId = 'session-123';
      const messages: Type.Entity.Message[] = [
        createCompleteMessage(
          'msg-1',
          Type.LLM.UnifiedMessageRole.user,
          [{ type: 'text' as const, text: 'Hello' }],
          'user-1'
        )
      ];
      (mockChatHistoryRepository.getMessages as any).mockResolvedValue(messages);
      (mockChatHistoryPatcherRepository.getPatches as any).mockResolvedValue(undefined);

      // Act
      const result = await chatHistoryManager.getMessages(sessionId);

      // Assert
      expect(mockChatHistoryRepository.getMessages).toHaveBeenCalledWith(sessionId);
      expect(mockChatHistoryPatcherRepository.getPatches).toHaveBeenCalledWith(sessionId);
      expect(result).toEqual(messages);
    });
  });

  describe('patchMessages', () => {
    it('should throw error when patcher repository is not provided', async () => {
      // Arrange
      const containerWithoutPatcher = new Container();
      containerWithoutPatcher
        .bind<Repository.ChatHistory>(DI_TYPES.ChatHistoryRepository)
        .toConstantValue(mockChatHistoryRepository as unknown as Repository.ChatHistory);
      containerWithoutPatcher.bind<ChatHistoryManager>(ChatHistoryManager).toSelf();
      const managerWithoutPatcher = containerWithoutPatcher.get<ChatHistoryManager>(ChatHistoryManager);

      const sessionId = 'session-123';
      const messages: Type.Entity.Message[] = [
        createCompleteMessage(
          'msg-1',
          Type.LLM.UnifiedMessageRole.user,
          [{ type: 'text' as const, text: 'Hello' }],
          'user-1'
        )
      ];
      const patchData = { content: [{ type: 'text' as const, text: 'Updated content' }] };

      // Act & Assert
      await expect(managerWithoutPatcher.patchMessages(sessionId, messages, patchData)).rejects.toThrow(
        'ChatHistoryPatcherRepository is not provided'
      );
    });

    it('should call patcher repository with correct parameters', async () => {
      // Arrange
      const sessionId = 'session-123';
      const messages: Type.Entity.Message[] = [
        createCompleteMessage(
          'msg-1',
          Type.LLM.UnifiedMessageRole.user,
          [{ type: 'text' as const, text: 'Hello' }],
          'user-1'
        )
      ];
      const patchData = { content: [{ type: 'text' as const, text: 'Updated content' }] };
      const patches: Type.Entity.MessagePatch[] = [
        {
          id: 'patch-1',
          messageId: 'msg-1',
          content: [{ type: 'text' as const, text: 'Updated content' }],
          sequenceId: '1',
          sessionId: sessionId,
          createdAt: new Date(),
          patchAction: MessagePatchAction.PATCH
        }
      ];
      (mockChatHistoryPatcherRepository.patchMessages as any).mockResolvedValue(patches);

      // Act
      const result = await chatHistoryManager.patchMessages(sessionId, messages, patchData);

      // Assert
      expect(mockChatHistoryPatcherRepository.patchMessages).toHaveBeenCalledWith(sessionId, ['msg-1'], patchData);
      expect(result[0].content).toEqual([{ type: 'text' as const, text: 'Updated content' }]);
    });

    it('should handle multiple messages', async () => {
      // Arrange
      const sessionId = 'session-123';
      const messages: Type.Entity.Message[] = [
        createCompleteMessage(
          'msg-1',
          Type.LLM.UnifiedMessageRole.user,
          [{ type: 'text' as const, text: 'Hello' }],
          'user-1'
        ),
        createCompleteMessage(
          'msg-2',
          Type.LLM.UnifiedMessageRole.assistant,
          [{ type: 'text' as const, text: 'Hi there' }],
          'assistant'
        )
      ];
      const patchData = { content: [{ type: 'text' as const, text: 'Updated content' }] };
      const patches: Type.Entity.MessagePatch[] = [
        {
          id: 'patch-1',
          messageId: 'msg-1',
          content: [{ type: 'text' as const, text: 'Updated content' }],
          sequenceId: '1',
          sessionId: sessionId,
          createdAt: new Date(),
          patchAction: MessagePatchAction.PATCH
        },
        {
          id: 'patch-2',
          messageId: 'msg-2',
          content: [{ type: 'text' as const, text: 'Updated content' }],
          sequenceId: '2',
          sessionId: sessionId,
          createdAt: new Date(),
          patchAction: MessagePatchAction.PATCH
        }
      ];
      (mockChatHistoryPatcherRepository.patchMessages as any).mockResolvedValue(patches);

      // Act
      const result = await chatHistoryManager.patchMessages(sessionId, messages, patchData);

      // Assert
      expect(mockChatHistoryPatcherRepository.patchMessages).toHaveBeenCalledWith(
        sessionId,
        ['msg-1', 'msg-2'],
        patchData
      );
      expect(result[0].content).toEqual([{ type: 'text' as const, text: 'Updated content' }]);
      expect(result[1].content).toEqual([{ type: 'text' as const, text: 'Updated content' }]);
    });

    it('should handle empty messages array', () => {
      // Arrange
      const messages: Type.Entity.Message[] = [];
      const patches: Type.Entity.MessagePatch[] = [
        {
          id: 'patch-1',
          messageId: 'msg-1',
          content: [{ type: 'text' as const, text: 'Hello updated' }],
          sequenceId: '1',
          sessionId: 'session-123',
          createdAt: new Date(),
          patchAction: MessagePatchAction.PATCH
        }
      ];

      // Act
      const result = patchMessages(messages, patches);

      // Assert
      expect(result).toEqual([]);
      expect(result).not.toBe(messages);
    });

    it('should handle various patch data fields', async () => {
      // Arrange
      const sessionId = 'session-123';
      const messages: Type.Entity.Message[] = [
        createCompleteMessage(
          'msg-1',
          Type.LLM.UnifiedMessageRole.user,
          [{ type: 'text' as const, text: 'Hello' }],
          'user-1'
        )
      ];
      const patchData = {
        content: [{ type: 'text' as const, text: 'Updated content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'new-author',
        llmName: 'gpt-4',
        manifestName: 'test-manifest',
        llmIgnore: true,
        ctx: { key: 'value' }
      };
      const patches: Type.Entity.MessagePatch[] = [
        {
          id: 'patch-1',
          messageId: 'msg-1',
          ...patchData,
          sequenceId: '1',
          sessionId: sessionId,
          createdAt: new Date(),
          patchAction: MessagePatchAction.PATCH
        }
      ];
      (mockChatHistoryPatcherRepository.patchMessages as any).mockResolvedValue(patches);

      // Act
      const result = await chatHistoryManager.patchMessages(sessionId, messages, patchData);

      // Assert
      expect(mockChatHistoryPatcherRepository.patchMessages).toHaveBeenCalledWith(sessionId, ['msg-1'], patchData);
      expect(result[0].content).toEqual([{ type: 'text' as const, text: 'Updated content' }]);
      expect(result[0].role).toBe(Type.LLM.UnifiedMessageRole.assistant);
      expect(result[0].author).toBe('new-author');
      expect(result[0].llmName).toBe('gpt-4');
      expect(result[0].manifestName).toBe('test-manifest');
      expect(result[0].llmIgnore).toBe(true);
      expect(result[0].ctx).toEqual({ key: 'value' });
    });

    it('should handle patches with undefined values', () => {
      // Arrange
      const messages: Type.Entity.Message[] = [
        {
          ...createCompleteMessage(
            'msg-1',
            Type.LLM.UnifiedMessageRole.user,
            [{ type: 'text' as const, text: 'Hello' }],
            'user-1'
          ),
          ctx: { key1: 'value1', key2: 'value2' }
        }
      ];

      // Create a patch with undefined values
      const patches: Type.Entity.MessagePatch[] = [
        {
          id: 'patch-1',
          messageId: 'msg-1',
          content: undefined, // Explicitly set undefined for content
          // NOT setting ctx to avoid overwriting the entire object
          sequenceId: '1',
          sessionId: 'session-123',
          createdAt: new Date(),
          patchAction: MessagePatchAction.PATCH
        }
      ];

      // Act
      const result = patchMessages(messages, patches);

      // Assert
      expect(result).toHaveLength(1);
      // undefined for content should not change the existing value
      expect(result[0].content).toEqual([{ type: 'text' as const, text: 'Hello' }]); // Should remain unchanged
      // ctx doesn't change since the patch doesn't contain ctx
      expect(result[0].ctx.key1).toBe('value1');
      expect(result[0].ctx.key2).toBe('value2');
    });

    it('should handle patches that attempt to set invalid values', () => {
      // Arrange
      const messages: Type.Entity.Message[] = [
        {
          ...createCompleteMessage(
            'msg-1',
            Type.LLM.UnifiedMessageRole.user,
            [{ type: 'text' as const, text: 'Hello' }],
            'user-1'
          ),
          ctx: { existingKey: 'existingValue' }
        }
      ];

      const patchToApply = {
        id: 'patch-1',
        messageId: 'msg-1',
        ctx: { newKey: 'newValue' },
        sequenceId: '1',
        sessionId: 'session-123',
        createdAt: new Date(),
        patchAction: MessagePatchAction.PATCH
      };

      // Emulate a situation where a patch may contain invalid values
      const patchWithInvalidValues = {
        ...patchToApply,
        content: [{ type: 'text' as const, text: 'Content with invalid values' }],
        invalidField: 'this should be ignored'
      };

      // Act
      const result = patchMessages(messages, [patchWithInvalidValues as unknown as Type.Entity.MessagePatch]);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].content).toEqual([{ type: 'text' as const, text: 'Content with invalid values' }]);
      // ctx is completely replaced, so there will be only newKey
      expect(result[0].ctx).toEqual({ newKey: 'newValue' });
      // Invalid field should not be added to the result
      expect('invalidField' in result[0]).toBe(false);
    });

    it('should handle conflict when multiple patches modify the same message with the same sequenceId', () => {
      // Arrange
      const messages: Type.Entity.Message[] = [
        createCompleteMessage(
          'msg-1',
          Type.LLM.UnifiedMessageRole.user,
          [{ type: 'text' as const, text: 'Original content' }],
          'user-1'
        )
      ];

      const patches: Type.Entity.MessagePatch[] = [
        {
          id: 'patch-1',
          messageId: 'msg-1',
          content: [{ type: 'text' as const, text: 'First update' }],
          sequenceId: '1',
          sessionId: 'session-123',
          createdAt: new Date(2023, 0, 1, 10, 0, 0), // Older patch
          patchAction: MessagePatchAction.PATCH
        },
        {
          id: 'patch-2',
          messageId: 'msg-1',
          content: [{ type: 'text' as const, text: 'Second update' }],
          sequenceId: '1', // Same sequenceId
          sessionId: 'session-123',
          createdAt: new Date(2023, 0, 1, 10, 0, 1), // Newer patch
          patchAction: MessagePatchAction.PATCH
        }
      ];

      // Act
      const result = patchMessages(messages, patches);

      // Assert
      expect(result).toHaveLength(1);
      // Check that the most recent patch is applied when there's a conflict
      expect(result[0].content).toEqual([{ type: 'text' as const, text: 'Second update' }]);
    });

    it('should not allow changing immutable fields through patches', () => {
      // Arrange
      const originalId = 'msg-1';
      const originalSessionId = 'session-123';
      const originalCreatedAt = new Date(2023, 0, 1);

      const messages: Type.Entity.Message[] = [
        {
          ...createCompleteMessage(
            originalId,
            Type.LLM.UnifiedMessageRole.user,
            [{ type: 'text' as const, text: 'Original content' }],
            'user-1'
          ),
          sessionId: originalSessionId,
          createdAt: originalCreatedAt
        }
      ];

      // Create a patch that has fields which should not be changed
      const patches: Type.Entity.MessagePatch[] = [
        {
          id: 'patch-1',
          messageId: originalId,
          content: [{ type: 'text' as const, text: 'Updated content' }],
          sequenceId: '1',
          sessionId: 'new-session', // Attempt to change sessionId, but it should not take effect
          createdAt: new Date(2023, 0, 2), // Patch date, not message date
          patchAction: MessagePatchAction.PATCH
        }
      ];

      // Act
      const result = patchMessages(messages, patches);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].content).toEqual([{ type: 'text' as const, text: 'Updated content' }]); // Content should be updated
      // Immutable fields should not change
      expect(result[0].id).toBe(originalId);
      expect(result[0].sessionId).toBe(originalSessionId);
      expect(result[0].createdAt).toBe(originalCreatedAt);
    });

    it('should ignore patches with invalid messageId', () => {
      // Arrange
      const messages: Type.Entity.Message[] = [
        createCompleteMessage(
          'msg-1',
          Type.LLM.UnifiedMessageRole.user,
          [{ type: 'text' as const, text: 'Hello' }],
          'user-1'
        )
      ];
      const patches: Type.Entity.MessagePatch[] = [
        {
          id: 'patch-1',
          messageId: 'non-existent-id', // ID of a message that doesn't exist in the collection
          content: [{ type: 'text' as const, text: 'This should be ignored' }],
          sequenceId: '1',
          sessionId: 'session-123',
          createdAt: new Date(),
          patchAction: MessagePatchAction.PATCH
        }
      ];

      // Act
      const result = patchMessages(messages, patches);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].content).toEqual([{ type: 'text' as const, text: 'Hello' }]); // Content shouldn't change
      expect(result).not.toBe(messages);
    });
  });

  describe('checkHealth', () => {
    it('should return true when both repositories are healthy', async () => {
      // Arrange
      (mockChatHistoryRepository.checkHealth as any).mockResolvedValue(true);
      (mockChatHistoryPatcherRepository.checkHealth as any).mockResolvedValue(true);

      // Act
      const result = await chatHistoryManager.checkHealth();

      // Assert
      expect(mockChatHistoryRepository.checkHealth).toHaveBeenCalled();
      expect(mockChatHistoryPatcherRepository.checkHealth).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when chat history repository is unhealthy', async () => {
      // Arrange
      (mockChatHistoryRepository.checkHealth as any).mockResolvedValue(false);
      (mockChatHistoryPatcherRepository.checkHealth as any).mockResolvedValue(true);

      // Act
      const result = await chatHistoryManager.checkHealth();

      // Assert
      expect(mockChatHistoryRepository.checkHealth).toHaveBeenCalled();
      expect(mockChatHistoryPatcherRepository.checkHealth).toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('should return true when patcher repository is unhealthy but only chatHistoryRepository health is checked', async () => {
      // Arrange
      (mockChatHistoryRepository.checkHealth as any).mockResolvedValue(true);
      (mockChatHistoryPatcherRepository.checkHealth as any).mockResolvedValue(false);

      // Act
      const result = await chatHistoryManager.checkHealth();

      // Assert
      expect(mockChatHistoryRepository.checkHealth).toHaveBeenCalled();
      expect(mockChatHistoryPatcherRepository.checkHealth).toHaveBeenCalled();
      // The implementation returns chatHistoryHealth when !patcherHealth
      expect(result).toBe(true);
    });

    it('should return true when only chat history repository exists and is healthy', async () => {
      // Arrange
      const containerWithoutPatcher = new Container();
      containerWithoutPatcher
        .bind<Repository.ChatHistory>(DI_TYPES.ChatHistoryRepository)
        .toConstantValue(mockChatHistoryRepository as unknown as Repository.ChatHistory);
      containerWithoutPatcher.bind<ChatHistoryManager>(ChatHistoryManager).toSelf();
      const managerWithoutPatcher = containerWithoutPatcher.get<ChatHistoryManager>(ChatHistoryManager);

      (mockChatHistoryRepository.checkHealth as any).mockResolvedValue(true);

      // Act
      const result = await managerWithoutPatcher.checkHealth();

      // Assert
      expect(mockChatHistoryRepository.checkHealth).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when only chat history repository exists and is unhealthy', async () => {
      // Arrange
      const containerWithoutPatcher = new Container();
      containerWithoutPatcher
        .bind<Repository.ChatHistory>(DI_TYPES.ChatHistoryRepository)
        .toConstantValue(mockChatHistoryRepository as unknown as Repository.ChatHistory);
      containerWithoutPatcher.bind<ChatHistoryManager>(ChatHistoryManager).toSelf();
      const managerWithoutPatcher = containerWithoutPatcher.get<ChatHistoryManager>(ChatHistoryManager);

      (mockChatHistoryRepository.checkHealth as any).mockResolvedValue(false);

      // Act
      const result = await managerWithoutPatcher.checkHealth();

      // Assert
      expect(mockChatHistoryRepository.checkHealth).toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('should handle case when patcher repository returns undefined for health check', async () => {
      // Arrange
      (mockChatHistoryRepository.checkHealth as any).mockResolvedValue(true);
      (mockChatHistoryPatcherRepository.checkHealth as any).mockResolvedValue(undefined);

      // Act
      const result = await chatHistoryManager.checkHealth();

      // Assert
      expect(mockChatHistoryRepository.checkHealth).toHaveBeenCalled();
      expect(mockChatHistoryPatcherRepository.checkHealth).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });

  describe('end', () => {
    it('should call end on both repositories', async () => {
      // Arrange
      (mockChatHistoryRepository.end as any).mockResolvedValue();
      (mockChatHistoryPatcherRepository.end as any).mockResolvedValue();

      // Act
      await chatHistoryManager.end();

      // Assert
      expect(mockChatHistoryRepository.end).toHaveBeenCalled();
      expect(mockChatHistoryPatcherRepository.end).toHaveBeenCalled();
    });

    it('should call end only on chat history repository when patcher does not exist', async () => {
      // Arrange
      const containerWithoutPatcher = new Container();
      containerWithoutPatcher
        .bind<Repository.ChatHistory>(DI_TYPES.ChatHistoryRepository)
        .toConstantValue(mockChatHistoryRepository as unknown as Repository.ChatHistory);
      containerWithoutPatcher.bind<ChatHistoryManager>(ChatHistoryManager).toSelf();
      const managerWithoutPatcher = containerWithoutPatcher.get<ChatHistoryManager>(ChatHistoryManager);

      (mockChatHistoryRepository.end as any).mockResolvedValue();

      // Act
      await managerWithoutPatcher.end();

      // Assert
      expect(mockChatHistoryRepository.end).toHaveBeenCalled();
    });

    it('should handle errors from repositories', async () => {
      // Arrange
      const error = new Error('Connection error');
      (mockChatHistoryRepository.end as any).mockRejectedValue(error);
      (mockChatHistoryPatcherRepository.end as any).mockResolvedValue();

      // Act & Assert
      await expect(chatHistoryManager.end()).rejects.toThrow('Connection error');
    });
  });

  describe('patchMessages utility function', () => {
    it('should apply patches to messages in correct order', () => {
      // Arrange
      const messages: Type.Entity.Message[] = [
        createCompleteMessage(
          'msg-1',
          Type.LLM.UnifiedMessageRole.user,
          [{ type: 'text' as const, text: 'Hello' }],
          'user-1'
        )
      ];
      const patches: Type.Entity.MessagePatch[] = [
        {
          id: 'patch-2',
          messageId: 'msg-1',
          content: [{ type: 'text' as const, text: 'Hello updated again' }],
          sequenceId: '2',
          sessionId: 'session-123',
          createdAt: new Date(),
          patchAction: MessagePatchAction.PATCH
        },
        {
          id: 'patch-1',
          messageId: 'msg-1',
          content: [{ type: 'text' as const, text: 'Hello updated' }],
          sequenceId: '1',
          sessionId: 'session-123',
          createdAt: new Date(),
          patchAction: MessagePatchAction.PATCH
        }
      ];

      // Act
      const result = patchMessages(messages, patches);

      // Assert
      expect(result[0].content).toEqual([{ type: 'text' as const, text: 'Hello updated again' }]);
    });

    it('should not modify original messages', () => {
      // Arrange
      const originalDate = new Date();
      const messages: Type.Entity.Message[] = [
        {
          ...createCompleteMessage(
            'msg-1',
            Type.LLM.UnifiedMessageRole.user,
            [{ type: 'text' as const, text: 'Hello' }],
            'user-1'
          ),
          createdAt: originalDate
        }
      ];
      const patches: Type.Entity.MessagePatch[] = [
        {
          id: 'patch-1',
          messageId: 'msg-1',
          content: [{ type: 'text' as const, text: 'Hello updated' }],
          sequenceId: '1',
          sessionId: 'session-123',
          createdAt: new Date(),
          patchAction: MessagePatchAction.PATCH
        }
      ];

      // Act
      const result = patchMessages(messages, patches);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].content).toEqual([{ type: 'text' as const, text: 'Hello updated' }]);
      // Ensure the original date is preserved
      expect(result[0].createdAt).toBe(originalDate);
    });

    it('should handle patches for non-existent messages', () => {
      // Arrange
      const messages: Type.Entity.Message[] = [
        createCompleteMessage(
          'msg-1',
          Type.LLM.UnifiedMessageRole.user,
          [{ type: 'text' as const, text: 'Hello' }],
          'user-1'
        )
      ];
      const patches: Type.Entity.MessagePatch[] = [
        {
          id: 'patch-1',
          messageId: 'non-existent',
          content: [{ type: 'text' as const, text: 'Hello updated' }],
          sequenceId: '1',
          sessionId: 'session-123',
          createdAt: new Date(),
          patchAction: MessagePatchAction.PATCH
        }
      ];

      // Act
      const result = patchMessages(messages, patches);

      // Assert
      expect(result).toEqual(messages);
      expect(result).not.toBe(messages);
    });

    it('should apply all patch fields correctly', () => {
      // Arrange
      const originalDate = new Date();
      const messages: Type.Entity.Message[] = [
        {
          ...createCompleteMessage(
            'msg-1',
            Type.LLM.UnifiedMessageRole.user,
            [{ type: 'text' as const, text: 'Hello' }],
            'user-1'
          ),
          createdAt: originalDate
        }
      ];
      const patches: Type.Entity.MessagePatch[] = [
        {
          id: 'patch-1',
          messageId: 'msg-1',
          content: [{ type: 'text' as const, text: 'Updated content' }],
          role: Type.LLM.UnifiedMessageRole.assistant,
          author: 'new-author',
          llmName: 'gpt-4',
          manifestName: 'new-manifest',
          llmIgnore: true,
          ctx: { new: 'data' },
          sequenceId: '1',
          sessionId: 'session-123',
          createdAt: new Date(),
          patchAction: MessagePatchAction.PATCH
        }
      ];

      // Act
      const result = patchMessages(messages, patches);

      // Assert
      expect(result[0].content).toEqual([{ type: 'text' as const, text: 'Updated content' }]);
      expect(result[0].role).toBe(Type.LLM.UnifiedMessageRole.assistant);
      expect(result[0].author).toBe('new-author');
      expect(result[0].llmName).toBe('gpt-4');
      expect(result[0].manifestName).toBe('new-manifest');
      expect(result[0].llmIgnore).toBe(true);
      expect(result[0].ctx).toEqual({ new: 'data' });
    });

    it('should handle empty patches array', () => {
      // Arrange
      const messages: Type.Entity.Message[] = [
        createCompleteMessage(
          'msg-1',
          Type.LLM.UnifiedMessageRole.user,
          [{ type: 'text' as const, text: 'Hello' }],
          'user-1'
        )
      ];
      const patches: Type.Entity.MessagePatch[] = [];

      // Act
      const result = patchMessages(messages, patches);

      // Assert
      expect(result).toEqual(messages);
      expect(result).not.toBe(messages);
    });

    it('should handle empty messages array', () => {
      // Arrange
      const messages: Type.Entity.Message[] = [];
      const patches: Type.Entity.MessagePatch[] = [
        {
          id: 'patch-1',
          messageId: 'msg-1',
          content: [{ type: 'text' as const, text: 'Hello updated' }],
          sequenceId: '1',
          sessionId: 'session-123',
          createdAt: new Date(),
          patchAction: MessagePatchAction.PATCH
        }
      ];

      // Act
      const result = patchMessages(messages, patches);

      // Assert
      expect(result).toEqual([]);
      expect(result).not.toBe(messages);
    });
  });
});
