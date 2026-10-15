import { Repository, Type } from '@moc-global/loft-definitions';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatHistory } from '../../../entities/ChatHistory';
import { Message } from '../../../entities/Message';

describe('ChatHistory and Message Integration', () => {
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
    role: Type.LLM.UnifiedMessageRole = Type.LLM.UnifiedMessageRole.user,
    ctx: Record<string, unknown> = {}
  ): Type.Entity.Message => ({
    id,
    sessionId: mockSessionId,
    sequenceId: '1',
    ctx,
    content,
    role,
    author: role === Type.LLM.UnifiedMessageRole.user ? 'user' : 'assistant',
    llmName: 'test-llm-name',
    manifestName: 'test-manifest-name',
    llmIgnore: false,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  // Reset mocks before each test
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Adding messages', () => {
    it('should create Message instances when adding new messages', async () => {
      // Arrange
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, []);
      const newMessage = createMockMessage('1', [{ type: 'text' as const, text: 'Test message' }]);

      vi.mocked(mockChatHistoryManager.addMessages).mockResolvedValueOnce([newMessage]);

      // Act
      await chatHistory.addMessages([newMessage]);

      // Assert
      expect([...chatHistory.messages]).toHaveLength(1);
      expect([...chatHistory.messages][0]).toBeInstanceOf(Message);
      expect([...chatHistory.messages][0].id).toBe('1');
      expect([...chatHistory.messages][0].content).toEqual([{ type: 'text' as const, text: 'Test message' }]);
    });

    it('should preserve ctx data when creating Message instances', async () => {
      // Arrange
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, []);
      const complexCtx = {
        important: true,
        metadata: { source: 'test' }
      };
      const newMessage = createMockMessage(
        '1',
        [{ type: 'text' as const, text: 'Test message' }],
        Type.LLM.UnifiedMessageRole.user,
        complexCtx
      );

      vi.mocked(mockChatHistoryManager.addMessages).mockResolvedValueOnce([newMessage]);

      // Act
      await chatHistory.addMessages([newMessage]);

      // Assert
      const message = [...chatHistory.messages][0];
      expect(message.ctx).toEqual(complexCtx);

      // Verify the ctx is properly accessible and modifiable through the Message instance
      message.ctx = { additionalData: 'new value' };
      expect(message.ctx).toEqual({
        important: true,
        metadata: { source: 'test' },
        additionalData: 'new value'
      });
    });

    it('should add multiple messages of different types', async () => {
      // Arrange
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, []);
      const userMessage = createMockMessage(
        '1',
        [{ type: 'text' as const, text: 'User question' }],
        Type.LLM.UnifiedMessageRole.user
      );
      const assistantMessage = createMockMessage(
        '2',
        [{ type: 'text' as const, text: 'Assistant response' }],
        Type.LLM.UnifiedMessageRole.assistant
      );
      const systemMessage = createMockMessage(
        '3',
        [{ type: 'text' as const, text: 'System instruction' }],
        Type.LLM.UnifiedMessageRole.system
      );

      vi.mocked(mockChatHistoryManager.addMessages).mockResolvedValueOnce([
        userMessage,
        assistantMessage,
        systemMessage
      ]);

      // Act
      await chatHistory.addMessages([userMessage, assistantMessage, systemMessage]);

      // Assert
      const messages = [...chatHistory.messages];
      expect(messages).toHaveLength(3);
      expect(messages[0].role).toBe(Type.LLM.UnifiedMessageRole.user);
      expect(messages[1].role).toBe(Type.LLM.UnifiedMessageRole.assistant);
      expect(messages[2].role).toBe(Type.LLM.UnifiedMessageRole.system);
    });
  });

  describe('Patching messages', () => {
    it('should update Message instances when patching', async () => {
      // Arrange
      const initialMessage = createMockMessage('1', [{ type: 'text' as const, text: 'Initial content' }]);
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, [initialMessage]);

      const patchedMessage = {
        ...initialMessage,
        content: [{ type: 'text' as const, text: 'Updated content' }]
      };

      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([patchedMessage]);

      // Act
      await chatHistory.patchMessages(['1'], {
        content: [{ type: 'text' as const, text: 'Updated content' }]
      } as Type.Entity.MessagePatch);

      // Assert
      const message = [...chatHistory.messages][0];
      expect(message.content).toEqual([{ type: 'text' as const, text: 'Updated content' }]);
      expect(message).toBeInstanceOf(Message);
    });

    it('should handle patching multiple messages simultaneously', async () => {
      // Arrange
      const message1 = createMockMessage('1', [{ type: 'text' as const, text: 'Message 1' }]);
      const message2 = createMockMessage('2', [{ type: 'text' as const, text: 'Message 2' }]);
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, [message1, message2]);

      const patchedMessage1 = {
        ...message1,
        content: [{ type: 'text' as const, text: 'Updated Message 1' }]
      };

      const patchedMessage2 = {
        ...message2,
        content: [{ type: 'text' as const, text: 'Updated Message 2' }]
      };

      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([patchedMessage1, patchedMessage2]);

      // Act
      await chatHistory.patchMessages(['1', '2'], {
        content: [{ type: 'text' as const, text: 'This will be overridden by the mock' }]
      } as Type.Entity.MessagePatch);

      // Assert
      const messages = [...chatHistory.messages];
      expect(messages[0].content).toEqual([{ type: 'text' as const, text: 'Updated Message 1' }]);
      expect(messages[1].content).toEqual([{ type: 'text' as const, text: 'Updated Message 2' }]);
    });

    it('should update ctx in Message instances when patching', async () => {
      // Arrange
      const initialCtx = { existing: 'value' };
      const initialMessage = createMockMessage(
        '1',
        [{ type: 'text' as const, text: 'Content' }],
        Type.LLM.UnifiedMessageRole.user,
        initialCtx
      );
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, [initialMessage]);

      const updatedCtx = {
        existing: 'value',
        new: 'property'
      };

      const patchedMessage = {
        ...initialMessage,
        ctx: updatedCtx
      };

      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([patchedMessage]);

      // Act
      await chatHistory.patchMessages(['1'], { ctx: { new: 'property' } } as unknown as Type.Entity.MessagePatch);

      // Assert
      const message = [...chatHistory.messages][0];
      expect(message.ctx).toEqual(updatedCtx);
    });
  });

  describe('Error handling', () => {
    it('should handle errors from Message.patch() during ChatHistory.patchMessages()', async () => {
      // Arrange
      const initialMessage = createMockMessage('1', [{ type: 'text' as const, text: 'Initial content' }]);
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, [initialMessage]);

      // Mock patchMessages to throw an error
      vi.mocked(mockChatHistoryManager.patchMessages).mockRejectedValueOnce(new Error('Failed to patch message'));

      // Act & Assert
      await expect(
        chatHistory.patchMessages(['1'], {
          content: [{ type: 'text' as const, text: 'Updated content' }]
        } as Type.Entity.MessagePatch)
      ).rejects.toThrow('Failed to patch message');

      // Verify the original message is still intact
      const message = [...chatHistory.messages][0];
      expect(message.content).toEqual([{ type: 'text' as const, text: 'Initial content' }]);
    });

    it('should maintain consistency when some messages fail to patch', async () => {
      // Arrange
      const message1 = createMockMessage('1', [{ type: 'text' as const, text: 'Message 1' }]);
      const message2 = createMockMessage('2', [{ type: 'text' as const, text: 'Message 2' }]);
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, [message1, message2]);

      // Mock patchMessages to return only one patched message
      const patchedMessage1 = {
        ...message1,
        content: [{ type: 'text' as const, text: 'Updated Message 1' }]
      };

      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([patchedMessage1]);

      // Act
      await chatHistory.patchMessages(['1', '2'], {
        content: [{ type: 'text' as const, text: 'Updated content' }]
      } as Type.Entity.MessagePatch);

      // Assert
      const messages = [...chatHistory.messages];
      expect(messages[0].content).toEqual([{ type: 'text' as const, text: 'Updated Message 1' }]);
      expect(messages[1].content).toEqual([{ type: 'text' as const, text: 'Message 2' }]); // This one wasn't updated
    });
  });

  describe('Complex scenarios', () => {
    it('should handle adding and then patching messages', async () => {
      // Arrange
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, []);
      const newMessage = createMockMessage('1', [{ type: 'text' as const, text: 'Initial content' }]);

      vi.mocked(mockChatHistoryManager.addMessages).mockResolvedValueOnce([newMessage]);

      // Act - First add a message
      await chatHistory.addMessages([newMessage]);

      // Then prepare to patch it
      const patchedMessage = {
        ...newMessage,
        content: [{ type: 'text' as const, text: 'Updated content' }]
      };

      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([patchedMessage]);

      // Act - Now patch the message
      await chatHistory.patchMessages(['1'], {
        content: [{ type: 'text' as const, text: 'Updated content' }]
      } as Type.Entity.MessagePatch);

      // Assert
      const message = [...chatHistory.messages][0];
      expect(message.content).toEqual([{ type: 'text' as const, text: 'Updated content' }]);
    });

    it('should handle changing message role and then updating content', async () => {
      // Arrange
      const initialMessage = createMockMessage(
        '1',
        [{ type: 'text' as const, text: 'User question' }],
        Type.LLM.UnifiedMessageRole.user
      );
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, [initialMessage]);

      // First patch - change role
      const firstPatchedMessage = {
        ...initialMessage,
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'assistant'
      };

      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([firstPatchedMessage]);

      // Act - First change the role
      await chatHistory.patchMessages(['1'], {
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'assistant'
      } as Type.Entity.MessagePatch);

      // Second patch - update content
      const secondPatchedMessage = {
        ...firstPatchedMessage,
        content: [{ type: 'text' as const, text: 'Assistant response' }]
      };

      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([secondPatchedMessage]);

      // Act - Now update the content
      await chatHistory.patchMessages(['1'], {
        content: [{ type: 'text' as const, text: 'Assistant response' }]
      } as Type.Entity.MessagePatch);

      // Assert
      const message = [...chatHistory.messages][0];
      expect(message.role).toBe(Type.LLM.UnifiedMessageRole.assistant);
      expect(message.author).toBe('assistant');
      expect(message.content).toEqual([{ type: 'text' as const, text: 'Assistant response' }]);
    });

    it('should handle querying messages after modifications', async () => {
      // Arrange
      const userMessage = createMockMessage(
        '1',
        [{ type: 'text' as const, text: 'User question' }],
        Type.LLM.UnifiedMessageRole.user
      );
      const assistantMessage = createMockMessage(
        '2',
        [{ type: 'text' as const, text: 'Assistant response' }],
        Type.LLM.UnifiedMessageRole.assistant
      );

      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, [userMessage, assistantMessage]);

      // Patch the assistant message
      const patchedMessage = {
        ...assistantMessage,
        content: [{ type: 'text' as const, text: 'Updated assistant response' }]
      };

      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([patchedMessage]);

      // Act - Patch the message
      await chatHistory.patchMessages(['2'], {
        content: [{ type: 'text' as const, text: 'Updated assistant response' }]
      } as Type.Entity.MessagePatch);

      // Act - Query for assistant messages
      const assistantMessages = chatHistory.messages.query({
        role: { $eq: Type.LLM.UnifiedMessageRole.assistant }
      });

      // Assert
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0].content).toEqual([{ type: 'text' as const, text: 'Updated assistant response' }]);
    });
  });

  describe('Edge cases', () => {
    it('should handle messages with very large content', async () => {
      // Arrange
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, []);

      // Create a message with very large content (50KB)
      const largeContent = 'A'.repeat(50 * 1024);
      const largeMessage = createMockMessage('large-1', [{ type: 'text' as const, text: largeContent }]);

      vi.mocked(mockChatHistoryManager.addMessages).mockResolvedValueOnce([largeMessage]);

      // Act
      await chatHistory.addMessages([largeMessage]);

      // Assert
      const message = [...chatHistory.messages][0];
      expect((message.content[0] as { type: 'text'; text: string }).text.length).toBe(50 * 1024);
      expect((message.content[0] as { type: 'text'; text: string }).text).toBe(largeContent);

      // Verify we can patch it
      const patchedMessage = {
        ...largeMessage,
        content: [{ type: 'text' as const, text: 'Shortened content' }]
      };

      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([patchedMessage]);

      // Act - patch the message
      await chatHistory.patchMessages(['large-1'], {
        content: [{ type: 'text' as const, text: 'Shortened content' }]
      } as Type.Entity.MessagePatch);

      // Assert
      expect([...chatHistory.messages][0].content).toEqual([{ type: 'text' as const, text: 'Shortened content' }]);
    });

    it('should handle messages with deeply nested ctx objects', async () => {
      // Arrange
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, []);

      // Create a deeply nested ctx object
      const deeplyNestedCtx = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  value: 'deeply nested value'
                }
              }
            }
          }
        }
      };

      const messageWithDeepCtx = createMockMessage(
        'deep-1',
        [{ type: 'text' as const, text: 'Message with deep ctx' }],
        Type.LLM.UnifiedMessageRole.user,
        deeplyNestedCtx
      );

      vi.mocked(mockChatHistoryManager.addMessages).mockResolvedValueOnce([messageWithDeepCtx]);

      // Act
      await chatHistory.addMessages([messageWithDeepCtx]);

      // Assert
      const message = [...chatHistory.messages][0];
      expect(message.ctx).toEqual(deeplyNestedCtx);

      // Verify we can update a deeply nested property
      const updatedCtx = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  value: 'updated nested value',
                  newProp: 'new property'
                }
              }
            }
          }
        }
      };

      const patchedMessage = {
        ...messageWithDeepCtx,
        ctx: updatedCtx
      };

      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([patchedMessage]);

      // Act - patch the message
      await chatHistory.patchMessages(['deep-1'], {
        ctx: {
          level1: {
            level2: {
              level3: {
                level4: {
                  level5: {
                    value: 'updated nested value',
                    newProp: 'new property'
                  }
                }
              }
            }
          }
        }
      } as unknown as Type.Entity.MessagePatch);

      // Assert
      expect([...chatHistory.messages][0].ctx).toEqual(updatedCtx);
    });

    it('should handle a large number of messages', async () => {
      // Arrange
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, []);

      // Create 100 messages
      const manyMessages = Array.from({ length: 100 }, (_, i) =>
        createMockMessage(
          `many-${i}`,
          [{ type: 'text' as const, text: `Message ${i}` }],
          i % 2 === 0 ? Type.LLM.UnifiedMessageRole.user : Type.LLM.UnifiedMessageRole.assistant
        )
      );

      vi.mocked(mockChatHistoryManager.addMessages).mockResolvedValueOnce(manyMessages);

      // Act
      await chatHistory.addMessages(manyMessages);

      // Assert
      expect([...chatHistory.messages].length).toBe(100);

      // Verify we can query them
      const userMessages = chatHistory.messages.query({
        role: { $eq: Type.LLM.UnifiedMessageRole.user }
      });

      const assistantMessages = chatHistory.messages.query({
        role: { $eq: Type.LLM.UnifiedMessageRole.assistant }
      });

      expect(userMessages.length).toBe(50);
      expect(assistantMessages.length).toBe(50);
    });

    it('should handle patching multiple properties simultaneously', async () => {
      // Arrange
      const initialMessage = createMockMessage(
        'multi-1',
        [{ type: 'text' as const, text: 'Initial content' }],
        Type.LLM.UnifiedMessageRole.user,
        {
          initial: 'value'
        }
      );
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, [initialMessage]);

      // Prepare a patch that changes multiple properties at once
      const patchedMessage = {
        ...initialMessage,
        content: [{ type: 'text' as const, text: 'Updated content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'assistant',
        llmIgnore: true,
        ctx: { initial: 'value', additional: 'property' }
      };

      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([patchedMessage]);

      // Act
      await chatHistory.patchMessages(['multi-1'], {
        content: [{ type: 'text' as const, text: 'Updated content' }],
        role: Type.LLM.UnifiedMessageRole.assistant,
        author: 'assistant',
        llmIgnore: true,
        ctx: { additional: 'property' }
      } as unknown as Type.Entity.MessagePatch);

      // Assert
      const message = [...chatHistory.messages][0];
      expect(message.content).toEqual([{ type: 'text' as const, text: 'Updated content' }]);
      expect(message.role).toBe(Type.LLM.UnifiedMessageRole.assistant);
      expect(message.author).toBe('assistant');
      expect(message.llmIgnore).toBe(true);
      expect(message.ctx).toEqual({ initial: 'value', additional: 'property' });
    });

    it('should handle messages with empty or null properties', async () => {
      // Arrange
      const chatHistory = new ChatHistory(mockSessionId, mockChatHistoryManager, []);

      // Create a message with empty content
      const emptyContentMessage = createMockMessage(
        'empty-1',
        [{ type: 'text' as const, text: '' }],
        Type.LLM.UnifiedMessageRole.user,
        {}
      );

      vi.mocked(mockChatHistoryManager.addMessages).mockResolvedValueOnce([emptyContentMessage]);

      // Act
      await chatHistory.addMessages([emptyContentMessage]);

      // Assert
      const message = [...chatHistory.messages][0];
      expect(message.content).toEqual([{ type: 'text' as const, text: '' }]);
      expect(message.ctx).toEqual({});

      // Patch with null-like values
      const patchedMessage = {
        ...emptyContentMessage,
        content: [{ type: 'text' as const, text: 'Some content' }],
        ctx: { nullValue: null, undefinedValue: undefined }
      };

      vi.mocked(mockChatHistoryManager.patchMessages).mockResolvedValueOnce([patchedMessage]);

      // Act - patch the message
      await chatHistory.patchMessages(['empty-1'], {
        content: [{ type: 'text' as const, text: 'Some content' }],
        ctx: { nullValue: null, undefinedValue: undefined }
      } as unknown as Type.Entity.MessagePatch);

      // Assert
      expect([...chatHistory.messages][0].content).toEqual([{ type: 'text' as const, text: 'Some content' }]);
      expect([...chatHistory.messages][0].ctx).toEqual({ nullValue: null, undefinedValue: undefined });
    });
  });
});
