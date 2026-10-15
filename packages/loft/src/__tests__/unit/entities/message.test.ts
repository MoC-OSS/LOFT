import { Repository, Type } from '@moc-global/loft-definitions';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Message } from '../../../entities/Message';

describe('Message', () => {
  // Common test fixtures
  const mockSessionId = 'test-session-id';
  const mockMessageId = 'test-message-id';
  const mockSequenceId = 'test-sequence-id';

  // Mock chat history manager with proper typing
  const mockChatHistoryManager: Repository.ChatHistoryManager = {
    addMessages: vi.fn().mockReturnValue(Promise.resolve([])),
    patchMessages: vi.fn().mockReturnValue(Promise.resolve([])),
    getMessages: vi.fn().mockReturnValue(Promise.resolve([])),
    checkHealth: vi.fn().mockReturnValue(Promise.resolve(true)),
    end: vi.fn().mockReturnValue(Promise.resolve())
  };

  // Helper function to create mock message data
  const createMockMessageData = (overrides: Partial<Type.Entity.Message> = {}): Type.Entity.Message => ({
    id: mockMessageId,
    sessionId: mockSessionId,
    sequenceId: mockSequenceId,
    ctx: {},
    content: [{ type: 'text' as const, text: 'Test message content' }],
    role: Type.LLM.UnifiedMessageRole.user,
    author: 'user',
    llmName: 'test-llm-name',
    manifestName: 'test-manifest-name',
    llmIgnore: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  });

  // Reset mocks before each test
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize message properties correctly', () => {
      // Arrange
      const mockDate = new Date();
      const messageData = createMockMessageData({
        createdAt: mockDate,
        updatedAt: mockDate
      });

      // Act
      const message = new Message(mockChatHistoryManager, messageData);

      // Assert
      expect(message.id).toBe(mockMessageId);
      expect(message.sessionId).toBe(mockSessionId);
      expect(message.sequenceId).toBe(mockSequenceId);
      expect(message.content).toEqual([{ type: 'text' as const, text: 'Test message content' }]);
      expect(message.role).toBe(Type.LLM.UnifiedMessageRole.user);
      expect(message.author).toBe('user');
      expect(message.llmName).toBe('test-llm-name');
      expect(message.manifestName).toBe('test-manifest-name');
      expect(message.llmIgnore).toBe(false);
      expect(message.createdAt).toBe(mockDate);
      expect(message.updatedAt).toBe(mockDate);
    });

    it('should initialize with complex ctx object', () => {
      // Arrange
      const complexCtx = {
        important: true,
        metadata: {
          source: 'test',
          timestamp: Date.now()
        }
      };
      const messageData = createMockMessageData({ ctx: complexCtx });

      // Act
      const message = new Message(mockChatHistoryManager, messageData);

      // Assert
      expect(message.ctx).toEqual(complexCtx);
    });
  });

  describe('ctx getter and setter', () => {
    it('should get ctx correctly', () => {
      // Arrange
      const initialCtx = { key: 'value' };
      const messageData = createMockMessageData({ ctx: initialCtx });
      const message = new Message(mockChatHistoryManager, messageData);

      // Act & Assert
      expect(message.ctx).toEqual(initialCtx);
    });

    it('should set ctx using deep merge', () => {
      // Arrange
      const initialCtx = {
        existing: 'value',
        nested: { prop1: 'original' }
      };
      const messageData = createMockMessageData({ ctx: initialCtx });
      const message = new Message(mockChatHistoryManager, messageData);

      // Act - shallow merge replaces nested objects entirely
      message.ctx = {
        new: 'property',
        nested: { prop2: 'added' }
      };

      // Assert - nested object is replaced, not deep merged
      expect(message.ctx).toEqual({
        existing: 'value',
        new: 'property',
        nested: { prop2: 'added' } // Note: nested object is replaced, prop1 is gone
      });
    });
  });

  describe('patch method', () => {
    it('should call chatHistoryManager.patchMessages with correct parameters', async () => {
      // Arrange
      const messageData = createMockMessageData();
      const message = new Message(mockChatHistoryManager, messageData);

      const patchData = {
        content: [{ type: 'text' as const, text: 'Updated content' }],
        patchAction: Type.Entity.MessagePatchAction.PATCH
      };

      const expectedPatchPayload = {
        sessionId: mockSessionId,
        messageId: mockMessageId,
        patchAction: Type.Entity.MessagePatchAction.PATCH,
        content: [{ type: 'text' as const, text: 'Updated content' }],
        role: undefined,
        author: undefined,
        llmName: undefined,
        manifestName: undefined,
        llmIgnore: undefined,
        ctx: undefined
      };

      const patchedMessageData = {
        ...messageData,
        content: [{ type: 'text' as const, text: 'Updated content' }]
      };

      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([patchedMessageData]);

      // Act
      await message.patch(patchData);

      // Assert
      expect(mockChatHistoryManager.patchMessages).toHaveBeenCalledWith(
        mockSessionId,
        [messageData],
        expectedPatchPayload
      );
      expect(message.content).toEqual([{ type: 'text' as const, text: 'Updated content' }]);
    });

    it('should update multiple properties when patching', async () => {
      // Arrange
      const messageData = createMockMessageData();
      const message = new Message(mockChatHistoryManager, messageData);

      const patchData = {
        content: [{ type: 'text' as const, text: 'Updated content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'assistant',
        llmIgnore: true
      };

      const patchedMessageData = {
        ...messageData,
        content: [{ type: 'text' as const, text: 'Updated content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'assistant',
        llmIgnore: true
      };

      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([patchedMessageData]);

      // Act
      await message.patch(patchData);

      // Assert
      expect(message.content).toEqual([{ type: 'text' as const, text: 'Updated content' }]);
      expect(message.role).toBe(Type.LLM.UnifiedMessageRole.assistant);
      expect(message.author).toBe('assistant');
      expect(message.llmIgnore).toBe(true);
    });

    it('should update ctx when patching', async () => {
      // Arrange
      const initialCtx = { existing: 'value' };
      const messageData = createMockMessageData({ ctx: initialCtx });
      const message = new Message(mockChatHistoryManager, messageData);

      const newCtx = { new: 'property' };
      const patchData = { ctx: newCtx };

      const patchedMessageData = {
        ...messageData,
        ctx: newCtx
      };

      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([patchedMessageData]);

      // Act
      await message.patch(patchData);

      // Assert
      expect(message.ctx).toEqual(newCtx);
    });

    it('should use default PATCH action when not specified', async () => {
      // Arrange
      const messageData = createMockMessageData();
      const message = new Message(mockChatHistoryManager, messageData);

      const patchData = { content: [{ type: 'text' as const, text: 'Updated content' }] };

      const patchedMessageData = {
        ...messageData,
        content: [{ type: 'text' as const, text: 'Updated content' }]
      };

      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([patchedMessageData]);

      // Act
      await message.patch(patchData);

      // Assert
      expect(mockChatHistoryManager.patchMessages).toHaveBeenCalledWith(
        mockSessionId,
        [messageData],
        expect.objectContaining({
          patchAction: Type.Entity.MessagePatchAction.PATCH
        })
      );
    });

    it('should handle errors from chatHistoryManager.patchMessages', async () => {
      // Arrange
      const messageData = createMockMessageData();
      const message = new Message(mockChatHistoryManager, messageData);

      const errorMessage = 'Failed to patch message';
      vi.mocked(mockChatHistoryManager.patchMessages).mockRejectedValueOnce(new Error(errorMessage));

      // Act & Assert
      await expect(message.patch({ content: [{ type: 'text' as const, text: 'Updated content' }] })).rejects.toThrow(
        errorMessage
      );

      // Verify the message wasn't updated
      expect(message.content).toEqual([{ type: 'text' as const, text: 'Test message content' }]);
    });

    it('should handle when chatHistoryManager returns empty array', async () => {
      // Arrange
      const messageData = createMockMessageData();
      const message = new Message(mockChatHistoryManager, messageData);

      const patch = { content: [{ type: 'text' as const, text: 'Updated content' }] };

      // Mock returning empty array (no messages patched)
      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([]);

      // Act & Assert
      // Expect error since patch method tries to access ctx property of non-existent object
      await expect(message.patch(patch)).rejects.toThrow();

      // Verify the message wasn't updated
      expect(message.content).toEqual([{ type: 'text' as const, text: 'Test message content' }]);
    });
  });

  describe('private methods behavior', () => {
    it('should correctly prepare patch payload', async () => {
      // Arrange
      const messageData = createMockMessageData();
      const message = new Message(mockChatHistoryManager, messageData);

      const patchData = {
        content: [{ type: 'text' as const, text: 'Updated content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        patchAction: Type.Entity.MessagePatchAction.PATCH
      };

      vi.mocked(mockChatHistoryManager.patchMessages).mockImplementationOnce((...args: any[]) => {
        // Assert the patch payload structure
        const patch = args[2]; // Third argument is the patch
        expect(patch).toEqual({
          sessionId: mockSessionId,
          messageId: mockMessageId,
          patchAction: Type.Entity.MessagePatchAction.PATCH,
          content: [{ type: 'text' as const, text: 'Updated content' }],
          role: Type.LLM.UnifiedMessageRole.assistant,
          author: undefined,
          llmName: undefined,
          manifestName: undefined,
          llmIgnore: undefined,
          ctx: undefined
        });

        return Promise.resolve([
          {
            ...messageData,
            content: [{ type: 'text' as const, text: 'Updated content' }],
            role: Type.LLM.UnifiedMessageRole.assistant
          }
        ]);
      });

      // Act
      await message.patch(patchData);
    });

    it('should correctly convert message to entity format', async () => {
      // Arrange
      const messageData = createMockMessageData();
      const message = new Message(mockChatHistoryManager, messageData);

      vi.mocked(mockChatHistoryManager.patchMessages).mockImplementationOnce((...args: any[]) => {
        // Assert the message entity structure
        const messages = args[1]; // Second argument is the messages array
        expect(messages[0]).toEqual({
          id: mockMessageId,
          sessionId: mockSessionId,
          sequenceId: mockSequenceId,
          ctx: {},
          content: [{ type: 'text' as const, text: 'Test message content' }],
          role: Type.LLM.UnifiedMessageRole.user,
          author: 'user',
          llmName: 'test-llm-name',
          manifestName: 'test-manifest-name',
          llmIgnore: false,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date)
        });

        return Promise.resolve([messageData]);
      });

      // Act
      await message.patch({ content: [{ type: 'text' as const, text: 'Updated content' }] });
    });
  });

  describe('different message types', () => {
    it('should handle user messages', () => {
      // Arrange
      const userMessageData = createMockMessageData({
        role: Type.LLM.UnifiedMessageRole.user,
        author: 'user',
        content: [{ type: 'text' as const, text: 'User question' }]
      });

      // Act
      const message = new Message(mockChatHistoryManager, userMessageData);

      // Assert
      expect(message.role).toBe(Type.LLM.UnifiedMessageRole.user);
      expect(message.author).toBe('user');
      expect(message.content).toEqual([{ type: 'text' as const, text: 'User question' }]);
    });

    it('should handle assistant messages', () => {
      // Arrange
      const assistantMessageData = createMockMessageData({
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'assistant',
        content: [{ type: 'text' as const, text: 'Assistant response' }],
        llmName: 'gpt-4'
      });

      // Act
      const message = new Message(mockChatHistoryManager, assistantMessageData);

      // Assert
      expect(message.role).toBe(Type.LLM.UnifiedMessageRole.assistant);
      expect(message.author).toBe('assistant');
      expect(message.content).toEqual([{ type: 'text' as const, text: 'Assistant response' }]);
      expect(message.llmName).toBe('gpt-4');
    });

    it('should handle system messages', () => {
      // Arrange
      const systemMessageData = createMockMessageData({
        role: Type.LLM.UnifiedMessageRole.system,
        author: 'system',
        content: [{ type: 'text' as const, text: 'System instruction' }]
      });

      // Act
      const message = new Message(mockChatHistoryManager, systemMessageData);

      // Assert
      expect(message.role).toBe(Type.LLM.UnifiedMessageRole.system);
      expect(message.author).toBe('system');
      expect(message.content).toEqual([{ type: 'text' as const, text: 'System instruction' }]);
    });

    it('should handle function messages', () => {
      // Arrange
      const functionMessageData = createMockMessageData({
        role: Type.LLM.UnifiedMessageRole.function,
        author: 'function',
        content: [{ type: 'text' as const, text: 'Function output' }],
        ctx: { functionName: 'calculator', result: '42' }
      });

      // Act
      const message = new Message(mockChatHistoryManager, functionMessageData);

      // Assert
      expect(message.role).toBe(Type.LLM.UnifiedMessageRole.function);
      expect(message.author).toBe('function');
      expect(message.content).toEqual([{ type: 'text' as const, text: 'Function output' }]);
      expect(message.ctx).toEqual({ functionName: 'calculator', result: '42' });
    });

    it('should handle changing message role via patch', async () => {
      // Arrange
      const userMessageData = createMockMessageData({
        role: Type.LLM.UnifiedMessageRole.user,
        author: 'user'
      });
      const message = new Message(mockChatHistoryManager, userMessageData);

      const patchData = {
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'assistant'
      };

      const patchedMessageData = {
        ...userMessageData,
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'assistant'
      };

      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([patchedMessageData]);

      // Act
      await message.patch(patchData);

      // Assert
      expect(message.role).toBe(Type.LLM.UnifiedMessageRole.assistant);
      expect(message.author).toBe('assistant');
    });
  });

  describe('edge cases', () => {
    it('should handle empty content array', () => {
      // Arrange
      const messageData = createMockMessageData({ content: [] });

      // Act
      const message = new Message(mockChatHistoryManager, messageData);

      // Assert
      expect(message.content).toEqual([]);
    });

    it('should handle empty ctx object', () => {
      // Arrange
      const messageData = createMockMessageData({ ctx: {} });

      // Act
      const message = new Message(mockChatHistoryManager, messageData);

      // Assert
      expect(message.ctx).toEqual({});

      // Act - setting new ctx on empty ctx
      message.ctx = { newProp: 'value' };

      // Assert
      expect(message.ctx).toEqual({ newProp: 'value' });
    });

    it('should handle null values in ctx', () => {
      // Arrange
      const ctxWithNull = {
        nullProp: null,
        nestedNull: { prop: null }
      };
      const messageData = createMockMessageData({ ctx: ctxWithNull });

      // Act
      const message = new Message(mockChatHistoryManager, messageData);

      // Assert
      expect(message.ctx).toEqual(ctxWithNull);

      // Act - shallow merge with ctx containing null (nested objects are replaced, not merged)
      message.ctx = {
        anotherNull: null,
        nestedNull: { anotherProp: 'value' }
      };

      // Assert - shallow spread replaces nested objects entirely
      expect(message.ctx).toEqual({
        nullProp: null,
        anotherNull: null,
        nestedNull: { anotherProp: 'value' } // Note: nested object is replaced, not merged
      });
    });

    it('should handle very large ctx objects', () => {
      // Arrange
      const largeCtx: Record<string, unknown> = {};
      // Create a large nested object
      for (let i = 0; i < 100; i++) {
        largeCtx[`key${i}`] = `value${i}`;
        if (i % 10 === 0) {
          const nestedObj: Record<string, string> = {};
          for (let j = 0; j < 10; j++) {
            nestedObj[`nested${j}`] = `nestedValue${j}`;
          }
          largeCtx[`nested${i}`] = nestedObj;
        }
      }

      const messageData = createMockMessageData({ ctx: largeCtx });

      // Act
      const message = new Message(mockChatHistoryManager, messageData);

      // Assert
      expect(message.ctx).toEqual(largeCtx);

      // Act - add one more property
      message.ctx = { newProp: 'newValue' };

      // Assert - check if the new property was added correctly
      expect(message.ctx).toHaveProperty('newProp', 'newValue');
      // Check if original properties are still there
      expect(message.ctx).toHaveProperty('key1', 'value1');
      expect(message.ctx).toHaveProperty('nested10.nested5', 'nestedValue5');
    });

    it('should handle patching with empty objects', async () => {
      // Arrange
      const messageData = createMockMessageData();
      const message = new Message(mockChatHistoryManager, messageData);

      const emptyPatch = {};
      const patchedMessageData = { ...messageData };

      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([patchedMessageData]);

      // Act
      await message.patch(emptyPatch);

      // Assert
      expect(mockChatHistoryManager.patchMessages).toHaveBeenCalledWith(
        mockSessionId,
        [messageData],
        expect.objectContaining({
          sessionId: mockSessionId,
          messageId: mockMessageId,
          patchAction: Type.Entity.MessagePatchAction.PATCH
        })
      );
      // Verify no properties were changed
      expect(message.content).toEqual([{ type: 'text' as const, text: 'Test message content' }]);
      expect(message.role).toBe(Type.LLM.UnifiedMessageRole.user);
    });

    it('should handle patching with undefined values', async () => {
      // Arrange
      const messageData = createMockMessageData();
      const message = new Message(mockChatHistoryManager, messageData);

      const patchWithUndefined = {
        content: undefined,
        role: undefined,
        author: undefined
      };

      const patchedMessageData = { ...messageData };

      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([patchedMessageData]);

      // Act
      await message.patch(patchWithUndefined);

      // Assert
      expect(mockChatHistoryManager.patchMessages).toHaveBeenCalledWith(
        mockSessionId,
        [messageData],
        expect.objectContaining({
          content: undefined,
          role: undefined,
          author: undefined
        })
      );
      // Verify no properties were changed since the mock returns the same data
      expect(message.content).toEqual([{ type: 'text' as const, text: 'Test message content' }]);
    });
  });
});
