import { Repository, Type } from '@moc-global/loft-definitions';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatHistory } from '../../../entities/ChatHistory';

describe('ChatHistory', () => {
  // Common test fixtures
  const mockSessionId = 'test-session-id';

  // Mock chat history manager with proper typing
  const mockChatHistoryManager: Repository.ChatHistoryManager = {
    addMessages: vi.fn().mockReturnValue(Promise.resolve([])),
    patchMessages: vi.fn().mockReturnValue(Promise.resolve([])),
    getMessages: vi.fn().mockReturnValue(Promise.resolve([])),
    checkHealth: vi.fn().mockReturnValue(Promise.resolve(true)),
    end: vi.fn().mockReturnValue(Promise.resolve())
  };

  // Helper function to create mock messages
  const createMockMessage = (
    id: string,
    content: Type.Entity.FullContentPart[],
    role: Type.LLM.UnifiedMessageRole
  ): Type.Entity.Message => ({
    id,
    sessionId: mockSessionId,
    ctx: {},
    content: content,
    role,
    author: role === Type.LLM.UnifiedMessageRole.user ? 'user' : 'assistant',
    sequenceId: '1',
    llmIgnore: false,
    llmName: 'test-llm-name',
    manifestName: 'test-manifest-name',
    createdAt: new Date(),
    updatedAt: new Date()
  });

  // Reset mocks before each test
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize messages correctly when messages array is empty', () => {
      // Arrange
      const initialMessages: Type.Entity.Message[] = [];

      // Act
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, initialMessages);

      // Assert
      expect(chatHistory.messages).toBeDefined();
      expect([...chatHistory.messages]).toHaveLength(0);
    });

    it('should initialize messages correctly with initial messages', () => {
      // Arrange
      const initialMessages: Type.Entity.Message[] = [
        createMockMessage('1', [{ type: 'text' as const, text: 'Test message 1' }], Type.LLM.UnifiedMessageRole.user),
        createMockMessage(
          '2',
          [{ type: 'text' as const, text: 'Test message 2' }],
          Type.LLM.UnifiedMessageRole.assistant
        )
      ];

      // Act
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, initialMessages);

      // Assert
      expect([...chatHistory.messages]).toHaveLength(2);
      expect([...chatHistory.messages][0].id).toBe('1');
      expect([...chatHistory.messages][1].id).toBe('2');
    });
  });

  describe('addMessages', () => {
    let chatHistory: ChatHistory;

    beforeEach(() => {
      chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, []);
    });

    it('should throw error when no messages to add', async () => {
      // Act & Assert
      await expect(chatHistory.addMessages([])).rejects.toThrow('No messages to append to chat history.');
    });

    it('should throw error when messages have different sessionId', async () => {
      // Arrange
      const newMessages = [
        {
          ...createMockMessage('1', [{ type: 'text' as const, text: 'Test' }], Type.LLM.UnifiedMessageRole.user),
          sessionId: 'different-id'
        }
      ];

      // Act & Assert
      await expect(chatHistory.addMessages(newMessages)).rejects.toThrow(
        'All messages must have the same sessionId as the chat history.'
      );
    });

    it('should add new messages to the chat history', async () => {
      // Arrange
      const initialMessages: Type.Entity.Message[] = [
        createMockMessage('1', [{ type: 'text' as const, text: 'Initial message' }], Type.LLM.UnifiedMessageRole.user)
      ];
      chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, initialMessages);

      const newMessage = createMockMessage(
        '2',
        [{ type: 'text' as const, text: 'New message' }],
        Type.LLM.UnifiedMessageRole.assistant
      );
      vi.mocked(mockChatHistoryManager.addMessages).mockReturnValue(Promise.resolve([newMessage]));

      // Act
      await chatHistory.addMessages([newMessage]);

      // Assert
      const messages = [...chatHistory.messages];
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toEqual([{ type: 'text' as const, text: 'Initial message' }]);
      expect(messages[1].content).toEqual([{ type: 'text' as const, text: 'New message' }]);
      expect(mockChatHistoryManager.addMessages).toHaveBeenCalledWith(mockSessionId, [newMessage]);
    });

    it('should return added messages from addMessages method', async () => {
      // Arrange
      const initialMessages: Type.Entity.Message[] = [];
      chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, initialMessages);

      const newMessage = createMockMessage(
        '2',
        [{ type: 'text' as const, text: 'New message' }],
        Type.LLM.UnifiedMessageRole.assistant
      );
      vi.mocked(mockChatHistoryManager.addMessages).mockReturnValue(Promise.resolve([newMessage]));

      // Act
      const result = await chatHistory.addMessages([newMessage]);

      // Assert
      expect(result).toEqual([newMessage]);
      expect(mockChatHistoryManager.addMessages).toHaveBeenCalledWith(mockSessionId, [newMessage]);
    });
  });

  describe('patchMessages', () => {
    // Common test fixtures for patchMessages tests
    let chatHistory: ChatHistory;
    let initialMessages: Type.Entity.Message[];

    beforeEach(() => {
      initialMessages = [
        createMockMessage('1', [{ type: 'text' as const, text: 'Message 1' }], Type.LLM.UnifiedMessageRole.user),
        createMockMessage('2', [{ type: 'text' as const, text: 'Message 2' }], Type.LLM.UnifiedMessageRole.assistant)
      ];
      chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, initialMessages);
    });

    it('should patch messages correctly', async () => {
      // Arrange
      const patchedMessage = {
        ...initialMessages[0],
        content: [{ type: 'text' as const, text: 'Updated Message 1' }]
      };
      vi.mocked(mockChatHistoryManager.patchMessages).mockReturnValue(Promise.resolve([patchedMessage]));

      const patch: Partial<Type.Entity.MessagePatch> = {
        content: [{ type: 'text' as const, text: 'Updated Message 1' }]
      };

      // Act
      await chatHistory.patchMessages(['1'], patch as Type.Entity.MessagePatch);

      // Assert
      expect(mockChatHistoryManager.patchMessages).toHaveBeenCalledWith(
        mockSessionId,
        expect.arrayContaining([expect.objectContaining({ id: '1' })]),
        patch
      );

      const messages = [...chatHistory.messages];
      expect(messages[0].content).toEqual([{ type: 'text' as const, text: 'Updated Message 1' }]);
    });

    it('should handle empty messageIds array', async () => {
      // Arrange
      vi.mocked(mockChatHistoryManager.patchMessages).mockReturnValue(Promise.resolve([]));
      const patch: Partial<Type.Entity.MessagePatch> = {
        content: [{ type: 'text' as const, text: 'Updated Content' }]
      };

      // Act
      await chatHistory.patchMessages([], patch as Type.Entity.MessagePatch);

      // Assert
      expect(mockChatHistoryManager.patchMessages).toHaveBeenCalledWith(mockSessionId, [], patch);

      // Verify no messages were updated
      const messages = [...chatHistory.messages];
      expect(messages[0].content).toEqual([{ type: 'text' as const, text: 'Message 1' }]);
      expect(messages[1].content).toEqual([{ type: 'text' as const, text: 'Message 2' }]);
    });

    it('should handle non-existent message IDs', async () => {
      // Arrange
      vi.mocked(mockChatHistoryManager.patchMessages).mockReturnValue(Promise.resolve([]));
      const patch: Partial<Type.Entity.MessagePatch> = {
        content: [{ type: 'text' as const, text: 'Updated Content' }]
      };

      // Act
      await chatHistory.patchMessages(['non-existent-id'], patch as Type.Entity.MessagePatch);

      // Assert
      expect(mockChatHistoryManager.patchMessages).toHaveBeenCalledWith(mockSessionId, [], patch);

      // Verify no messages were updated
      const messages = [...chatHistory.messages];
      expect(messages[0].content).toEqual([{ type: 'text' as const, text: 'Message 1' }]);
      expect(messages[1].content).toEqual([{ type: 'text' as const, text: 'Message 2' }]);
    });

    it('should handle empty response from chatHistoryManager', async () => {
      // Arrange
      vi.mocked(mockChatHistoryManager.patchMessages).mockReturnValue(Promise.resolve([]));
      const patch: Partial<Type.Entity.MessagePatch> = {
        content: [{ type: 'text' as const, text: 'Updated Content' }]
      };

      // Act
      await chatHistory.patchMessages(['1'], patch as Type.Entity.MessagePatch);

      // Assert
      // Verify no messages were updated since the manager returned an empty array
      const messages = [...chatHistory.messages];
      expect(messages[0].content).toEqual([{ type: 'text' as const, text: 'Message 1' }]);
      expect(messages[1].content).toEqual([{ type: 'text' as const, text: 'Message 2' }]);
    });

    it('should patch multiple messages simultaneously', async () => {
      // Arrange
      const patchedMessages = [
        { ...initialMessages[0], content: [{ type: 'text' as const, text: 'Updated Message 1' }] },
        { ...initialMessages[1], content: [{ type: 'text' as const, text: 'Updated Message 2' }] }
      ];
      vi.mocked(mockChatHistoryManager.patchMessages).mockReturnValue(Promise.resolve(patchedMessages));
      const patch: Partial<Type.Entity.MessagePatch> = {
        content: [{ type: 'text' as const, text: 'This content will be overridden by the mock' }]
      };

      // Act
      await chatHistory.patchMessages(['1', '2'], patch as Type.Entity.MessagePatch);

      // Assert
      expect(mockChatHistoryManager.patchMessages).toHaveBeenCalledWith(
        mockSessionId,
        expect.arrayContaining([expect.objectContaining({ id: '1' }), expect.objectContaining({ id: '2' })]),
        patch
      );

      const messages = [...chatHistory.messages];
      expect(messages[0].content).toEqual([{ type: 'text' as const, text: 'Updated Message 1' }]);
      expect(messages[1].content).toEqual([{ type: 'text' as const, text: 'Updated Message 2' }]);
    });
  });

  describe('error handling', () => {
    it('should handle errors from chatHistoryManager.addMessages', async () => {
      // Arrange
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, []);
      const errorMessage = 'Failed to add messages';
      vi.mocked(mockChatHistoryManager.addMessages).mockRejectedValueOnce(new Error(errorMessage));
      const newMessage = createMockMessage(
        '1',
        [{ type: 'text' as const, text: 'Test message' }],
        Type.LLM.UnifiedMessageRole.user
      );

      // Act & Assert
      await expect(chatHistory.addMessages([newMessage])).rejects.toThrow(errorMessage);
    });

    it('should handle errors from chatHistoryManager.patchMessages', async () => {
      // Arrange
      const initialMessages: Type.Entity.Message[] = [
        createMockMessage('1', [{ type: 'text' as const, text: 'Message to patch' }], Type.LLM.UnifiedMessageRole.user)
      ];
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, initialMessages);
      const errorMessage = 'Failed to patch messages';
      vi.mocked(mockChatHistoryManager.patchMessages).mockRejectedValueOnce(new Error(errorMessage));
      const patch: Partial<Type.Entity.MessagePatch> = {
        content: [{ type: 'text' as const, text: 'Updated content' }]
      };

      // Act & Assert
      await expect(chatHistory.patchMessages(['1'], patch as Type.Entity.MessagePatch)).rejects.toThrow(errorMessage);

      // Verify the message wasn't updated
      const messages = [...chatHistory.messages];
      expect(messages[0].content).toEqual([{ type: 'text' as const, text: 'Message to patch' }]);
    });
  });

  // These tests are more integration-focused and could be moved to a separate file
  describe('integration with QueryByArrayOfObjects', () => {
    let chatHistory: ChatHistory;

    beforeEach(() => {
      const initialMessages: Type.Entity.Message[] = [
        createMockMessage('1', [{ type: 'text' as const, text: 'User message' }], Type.LLM.UnifiedMessageRole.user),
        createMockMessage(
          '2',
          [{ type: 'text' as const, text: 'Assistant message' }],
          Type.LLM.UnifiedMessageRole.assistant
        ),
        createMockMessage(
          '3',
          [{ type: 'text' as const, text: 'Another user message' }],
          Type.LLM.UnifiedMessageRole.user
        )
      ];
      chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, initialMessages);
    });

    it('should allow querying messages by properties', () => {
      // Query by role
      const userMessages = chatHistory.messages.query({ role: { $eq: Type.LLM.UnifiedMessageRole.user } });
      expect(userMessages).toHaveLength(2);
      expect(userMessages[0].id).toBe('1');
      expect(userMessages[1].id).toBe('3');

      // Query by content
      const messagesWithAssistant = chatHistory.messages.query({
        role: { $eq: Type.LLM.UnifiedMessageRole.assistant }
      });
      expect(messagesWithAssistant).toHaveLength(1);
      expect(messagesWithAssistant[0].id).toBe('2');
    });

    it('should allow complex queries with logical operators', () => {
      // Arrange
      const initialMessages: Type.Entity.Message[] = [
        createMockMessage(
          '1',
          [{ type: 'text' as const, text: 'First user message' }],
          Type.LLM.UnifiedMessageRole.user
        ),
        createMockMessage(
          '2',
          [{ type: 'text' as const, text: 'Assistant response' }],
          Type.LLM.UnifiedMessageRole.assistant
        ),
        createMockMessage(
          '3',
          [{ type: 'text' as const, text: 'Second user message' }],
          Type.LLM.UnifiedMessageRole.user
        )
      ];
      chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, initialMessages);

      // Act: Complex query with $or
      const results = chatHistory.messages.query({
        $or: [{ id: { $eq: '1' } }, { role: { $eq: Type.LLM.UnifiedMessageRole.assistant } }]
      });

      // Assert
      expect(results).toHaveLength(2);
      expect(results.some((msg) => msg.id === '1')).toBe(true);
      expect(results.some((msg) => msg.id === '2')).toBe(true);
      expect(results.some((msg) => msg.id === '3')).toBe(false);
    });
  });

  // These tests are more integration-focused and could be moved to a separate file
  describe('integration with different message types', () => {
    it('should handle system messages', async () => {
      // Arrange
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, []);
      const systemMessage = {
        id: 'sys-1',
        sessionId: mockSessionId,
        ctx: {},
        content: [{ type: 'text' as const, text: 'System instruction' }],
        role: Type.LLM.UnifiedMessageRole.system,
        author: 'system',
        sequenceId: '1',
        llmIgnore: false,
        llmName: 'test-llm-name',
        manifestName: 'test-manifest-name',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      vi.mocked(mockChatHistoryManager.addMessages).mockReturnValue(Promise.resolve([systemMessage]));

      // Act
      await chatHistory.addMessages([systemMessage]);

      // Assert
      const messages = [...chatHistory.messages];
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe(Type.LLM.UnifiedMessageRole.system);
      expect(messages[0].author).toBe('system');
    });

    it('should handle messages with different ctx values', async () => {
      // Arrange
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, []);
      const messageWithCtx = {
        id: 'ctx-1',
        sessionId: mockSessionId,
        ctx: {
          important: true,
          metadata: {
            source: 'test',
            timestamp: Date.now()
          }
        },
        content: [{ type: 'text' as const, text: 'Message with context' }],
        role: Type.LLM.UnifiedMessageRole.user,
        author: 'user',
        sequenceId: '1',
        llmIgnore: false,
        llmName: 'test-llm-name',
        manifestName: 'test-manifest-name',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      vi.mocked(mockChatHistoryManager.addMessages).mockReturnValue(Promise.resolve([messageWithCtx]));

      // Act
      await chatHistory.addMessages([messageWithCtx]);

      // Assert
      const messages = [...chatHistory.messages];
      expect(messages).toHaveLength(1);
      expect(messages[0].ctx).toEqual(
        expect.objectContaining({
          important: true,
          metadata: expect.objectContaining({
            source: 'test'
          })
        })
      );
    });
  });
});
