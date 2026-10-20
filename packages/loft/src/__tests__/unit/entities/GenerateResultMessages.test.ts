import { Interface, Repository, Strategy, Type } from '@moc-global/loft-definitions';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { GenerateResultMessages } from '../../../entities/GenerateResultMessages';
import { UsedToolMessage, validateToolsIntegrity } from '../../../utils/toolValidation';

const toolCall = (callId: string): Type.Entity.FullContentPart => ({
  type: 'tool_call',
  method: 'tools/call',
  callId,
  params: { name: 'lookup', arguments: {} }
});

const toolResult = (callId: string): Type.Entity.FullContentPart => ({
  type: 'tool_result',
  callId,
  content: [{ type: 'text', text: 'found' }]
});

function usedTool(id: string, role: UsedToolMessage['role'], content: Type.Entity.FullContentPart[]): UsedToolMessage {
  return {
    id,
    sessionId: 'session123',
    ctx: {},
    content,
    role,
    author: role,
    llmName: 'test-llm',
    manifestName: 'test-manifest',
    llmIgnore: false,
    setAppendFn: () => {},
    append: async () => ({}) as Type.Entity.Message
  };
}

// One assistant message with two parallel calls, then one tool message per result
const parallelTools: UsedToolMessage[] = [
  usedTool('call-msg', Type.LLM.UnifiedMessageRole.assistant, [toolCall('call-1'), toolCall('call-2')]),
  usedTool('result-1', Type.LLM.UnifiedMessageRole.tool, [toolResult('call-1')]),
  usedTool('result-2', Type.LLM.UnifiedMessageRole.tool, [toolResult('call-2')])
];

describe('GenerateResultMessages', () => {
  let mockAppendFn: Mock<Repository.ChatHistory['addMessages']>;
  let generateResultMessages: GenerateResultMessages;

  const mockDirectMessages: Interface.FacadeEntity.InteractiveOutputMessage[] = [
    {
      id: 'direct1',
      sessionId: 'session123',
      ctx: {},
      content: [{ type: 'text', text: 'Direct message 1' }],
      role: Type.LLM.UnifiedMessageRole.user,
      author: 'test-user',
      llmName: 'test-llm',
      manifestName: 'test-manifest',
      llmIgnore: false,
      setAppendFn: () => {},
      append: async () => ({}) as any
    },
    {
      id: 'direct2',
      sessionId: 'session123',
      ctx: {},
      content: [{ type: 'text', text: 'Direct message 2' }],
      role: Type.LLM.UnifiedMessageRole.user,
      author: 'test-user',
      llmName: 'test-llm',
      manifestName: 'test-manifest',
      llmIgnore: false,
      setAppendFn: () => {},
      append: async () => ({}) as any
    },
    {
      id: 'direct3',
      sessionId: 'session123',
      ctx: {},
      content: [{ type: 'text', text: 'Direct message 3' }],
      role: Type.LLM.UnifiedMessageRole.user,
      author: 'test-user',
      llmName: 'test-llm',
      manifestName: 'test-manifest',
      llmIgnore: false,
      setAppendFn: () => {},
      append: async () => ({}) as any
    }
  ];

  const mockAugmentedContext: Interface.FacadeEntity.InteractiveOutputMessage[] = [
    {
      id: 'aug1',
      sessionId: 'session123',
      ctx: {},
      content: [{ type: 'text', text: 'Augmented 1' }],
      role: Type.LLM.UnifiedMessageRole.system,
      author: 'test-system',
      llmName: 'test-llm',
      manifestName: 'test-manifest',
      llmIgnore: false,
      setAppendFn: () => {},
      append: async () => ({}) as any
    },
    {
      id: 'aug2',
      sessionId: 'session123',
      ctx: {},
      content: [{ type: 'text', text: 'Augmented 2' }],
      role: Type.LLM.UnifiedMessageRole.system,
      author: 'test-system',
      llmName: 'test-llm',
      manifestName: 'test-manifest',
      llmIgnore: false,
      setAppendFn: () => {},
      append: async () => ({}) as any
    },
    {
      id: 'aug3',
      sessionId: 'session123',
      ctx: {},
      content: [{ type: 'text', text: 'Augmented 3' }],
      role: Type.LLM.UnifiedMessageRole.system,
      author: 'test-system',
      llmName: 'test-llm',
      manifestName: 'test-manifest',
      llmIgnore: false,
      setAppendFn: () => {},
      append: async () => ({}) as any
    }
  ];

  const mockUsedTools: UsedToolMessage[] = [
    {
      id: 'tool1',
      sessionId: 'session123',
      ctx: {},
      content: [toolCall('call-1')],
      role: Type.LLM.UnifiedMessageRole.assistant,
      author: 'test-assistant',
      llmName: 'test-llm',
      manifestName: 'test-manifest',
      llmIgnore: false,
      setAppendFn: () => {},
      append: async () => ({}) as any
    },
    {
      id: 'tool2',
      sessionId: 'session123',
      ctx: {},
      content: [toolResult('call-1')],
      role: Type.LLM.UnifiedMessageRole.tool,
      author: 'test-tool',
      llmName: 'test-llm',
      manifestName: 'test-manifest',
      llmIgnore: false,
      setAppendFn: () => {},
      append: async () => ({}) as any
    }
  ];

  const mockTopChoice = {
    id: 'assistant1',
    sessionId: 'session123',
    ctx: {},
    content: [{ type: 'text' as const, text: 'Assistant response' }],
    role: Type.LLM.UnifiedMessageRole.assistant,
    author: 'test-assistant',
    llmName: 'test-llm',
    manifestName: 'test-manifest',
    llmIgnore: false,
    setAppendFn: () => {},
    append: async () => ({}) as any
  };

  const mockLlmResponse: Strategy.LLM.UnifiedLLMResponse = {
    topChoice: mockTopChoice,
    usedTools: mockUsedTools,
    choices: [mockTopChoice], // choices[0] should be the same as topChoice
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, model: 'test-model', finishReason: 'stop' },
    originalResponse: { usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } }
  };

  beforeEach(() => {
    mockAppendFn = vi.fn<Repository.ChatHistory['addMessages']>().mockResolvedValue([]);

    generateResultMessages = new GenerateResultMessages(
      mockDirectMessages,
      mockAugmentedContext,
      mockLlmResponse,
      'session123'
    );

    generateResultMessages.setAppendFn(mockAppendFn);
  });

  describe('validateToolsIntegrity', () => {
    it('should return true for valid tools with matching counts', () => {
      const validTools: UsedToolMessage[] = [
        {
          id: 'tool1',
          sessionId: 'session123',
          ctx: {},
          content: [toolCall('call-1')],
          role: Type.LLM.UnifiedMessageRole.assistant,
          author: 'test-assistant',
          llmName: 'test-llm',
          manifestName: 'test-manifest',
          llmIgnore: false,
          setAppendFn: () => {},
          append: async () => ({}) as any
        },
        {
          id: 'tool2',
          sessionId: 'session123',
          ctx: {},
          content: [toolResult('call-1')],
          role: Type.LLM.UnifiedMessageRole.tool,
          author: 'test-tool',
          llmName: 'test-llm',
          manifestName: 'test-manifest',
          llmIgnore: false,
          setAppendFn: () => {},
          append: async () => ({}) as any
        }
      ];

      expect(validateToolsIntegrity(validTools)).toBe(true);
    });

    it('should return false for invalid tools with mismatched counts', () => {
      const invalidTools: UsedToolMessage[] = [
        {
          id: 'tool1',
          sessionId: 'session123',
          ctx: {},
          content: [toolCall('call-1')],
          role: Type.LLM.UnifiedMessageRole.assistant,
          author: 'test-assistant',
          llmName: 'test-llm',
          manifestName: 'test-manifest',
          llmIgnore: false,
          setAppendFn: () => {},
          append: async () => ({}) as any
        },
        {
          id: 'tool2',
          sessionId: 'session123',
          ctx: {},
          content: [toolCall('call-2')],
          role: Type.LLM.UnifiedMessageRole.assistant,
          author: 'test-assistant',
          llmName: 'test-llm',
          manifestName: 'test-manifest',
          llmIgnore: false,
          setAppendFn: () => {},
          append: async () => ({}) as any
        },
        {
          id: 'tool3',
          sessionId: 'session123',
          ctx: {},
          content: [toolResult('call-1')],
          role: Type.LLM.UnifiedMessageRole.tool,
          author: 'test-tool',
          llmName: 'test-llm',
          manifestName: 'test-manifest',
          llmIgnore: false,
          setAppendFn: () => {},
          append: async () => ({}) as any
        }
      ];

      expect(validateToolsIntegrity(invalidTools)).toBe(false);
    });

    it('should return true for empty tools array', () => {
      expect(validateToolsIntegrity([])).toBe(true);
    });

    it('should accept parallel calls answered by one tool message each', () => {
      expect(validateToolsIntegrity(parallelTools)).toBe(true);
    });

    it('should reject parallel calls with a missing result', () => {
      expect(validateToolsIntegrity(parallelTools.slice(0, 2))).toBe(false);
    });

    it('should ignore messages marked llmIgnore', () => {
      const ignoredCall = {
        ...usedTool('ignored', Type.LLM.UnifiedMessageRole.assistant, [toolCall('x')]),
        llmIgnore: true
      };

      expect(validateToolsIntegrity([...parallelTools, ignoredCall])).toBe(true);
    });
  });

  describe('save() - Default Behavior', () => {
    it('should save all messages when options is empty object', async () => {
      await generateResultMessages.save({});

      expect(mockAppendFn).toHaveBeenCalledWith('session123', expect.any(Array));
      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(9); // 3 augmented + 3 direct + 2 tools + 1 assistant
    });

    it('should save all messages when options is undefined', async () => {
      await generateResultMessages.save();

      expect(mockAppendFn).toHaveBeenCalledWith('session123', expect.any(Array));
      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(9);
    });
  });

  describe('save() - Boolean Options', () => {
    it('should save all messages when all options are true', async () => {
      await generateResultMessages.save({
        saveAugmentedContext: true,
        saveDirectMessages: true,
        saveToolMessages: true,
        saveAssistantMessage: true
      });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(9);
    });

    it('should save no messages when all options are false', async () => {
      await generateResultMessages.save({
        saveAugmentedContext: false,
        saveDirectMessages: false,
        saveToolMessages: false,
        saveAssistantMessage: false
      });

      expect(mockAppendFn).not.toHaveBeenCalled();
    });

    it('should save mixed messages - case 1', async () => {
      await generateResultMessages.save({
        saveAugmentedContext: true,
        saveDirectMessages: false,
        saveToolMessages: true,
        saveAssistantMessage: false
      });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(5); // 3 augmented + 2 tools
    });

    it('should save mixed messages - case 2', async () => {
      await generateResultMessages.save({
        saveAugmentedContext: false,
        saveDirectMessages: true,
        saveToolMessages: false,
        saveAssistantMessage: true
      });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(4); // 3 direct + 1 assistant
    });
  });

  describe('save() - Index Array Options', () => {
    it('should save specific indices', async () => {
      await generateResultMessages.save({
        saveAugmentedContext: [0, 2],
        saveDirectMessages: [1],
        saveToolMessages: [0],
        saveAssistantMessage: true
      });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(5); // direct[1] + aug[0,2] + tool[0] + assistant
      expect(savedMessages[0]).toEqual(mockDirectMessages[1]);
      expect(savedMessages[1]).toEqual(mockAugmentedContext[0]);
      expect(savedMessages[2]).toEqual(mockAugmentedContext[2]);
      expect(savedMessages[3]).toEqual(mockUsedTools[0]);
      expect(savedMessages[4]).toEqual(mockLlmResponse.topChoice);
    });

    it('should handle empty arrays', async () => {
      await generateResultMessages.save({
        saveAugmentedContext: [],
        saveDirectMessages: [],
        saveToolMessages: []
      });

      expect(mockAppendFn).not.toHaveBeenCalled();
    });

    it('should handle out of bounds indices', async () => {
      await generateResultMessages.save({
        saveAugmentedContext: [10, 20],
        saveDirectMessages: [15],
        saveAssistantMessage: true
      });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(1); // only assistant
    });

    it('should handle negative indices', async () => {
      await generateResultMessages.save({
        saveAugmentedContext: [-1, -2],
        saveDirectMessages: [-5],
        saveAssistantMessage: true
      });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(1); // only assistant
    });
  });

  describe('save() - Mixed Boolean and Array Options', () => {
    it('should handle boolean + array mix 1', async () => {
      await generateResultMessages.save({
        saveAugmentedContext: true,
        saveDirectMessages: [0, 1],
        saveToolMessages: false,
        saveAssistantMessage: true
      });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(6); // direct[0,1] + aug[all] + assistant
    });

    it('should handle boolean + array mix 2', async () => {
      await generateResultMessages.save({
        saveAugmentedContext: [1, 2],
        saveDirectMessages: false,
        saveToolMessages: true,
        saveAssistantMessage: false
      });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(4); // aug[1,2] + tools[all]
    });
  });

  describe('save() - Partial Options', () => {
    it('should save only augmented context', async () => {
      await generateResultMessages.save({ saveAugmentedContext: true });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(3);
      expect(savedMessages).toEqual(mockAugmentedContext);
    });

    it('should save only direct messages with indices', async () => {
      await generateResultMessages.save({ saveDirectMessages: [0, 1] });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(2);
      expect(savedMessages[0]).toEqual(mockDirectMessages[0]);
      expect(savedMessages[1]).toEqual(mockDirectMessages[1]);
    });

    it('should not save tool messages when false', async () => {
      await generateResultMessages.save({ saveToolMessages: false });

      expect(mockAppendFn).not.toHaveBeenCalled();
    });

    it('should save only assistant message', async () => {
      await generateResultMessages.save({ saveAssistantMessage: true });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(1);
      expect(savedMessages[0]).toEqual(mockLlmResponse.topChoice);
    });
  });

  describe('save() - Tool Validation Edge Cases', () => {
    it('should save valid tools with saveToolMessages: true', async () => {
      await generateResultMessages.save({ saveToolMessages: true });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(2);
      expect(savedMessages).toEqual(mockUsedTools);
    });

    it('should skip invalid tools with saveToolMessages: true', async () => {
      const invalidTools: UsedToolMessage[] = [
        {
          id: 'tool1',
          sessionId: 'session123',
          ctx: {},
          content: [toolCall('call-1')],
          role: Type.LLM.UnifiedMessageRole.assistant,
          author: 'test-assistant',
          llmName: 'test-llm',
          manifestName: 'test-manifest',
          llmIgnore: false,
          setAppendFn: () => {},
          append: async () => ({}) as any
        },
        {
          id: 'tool2',
          sessionId: 'session123',
          ctx: {},
          content: [toolCall('call-2')],
          role: Type.LLM.UnifiedMessageRole.assistant,
          author: 'test-assistant',
          llmName: 'test-llm',
          manifestName: 'test-manifest',
          llmIgnore: false,
          setAppendFn: () => {},
          append: async () => ({}) as any
        }
      ];

      const resultWithInvalidTools = new GenerateResultMessages(
        mockDirectMessages,
        mockAugmentedContext,
        { ...mockLlmResponse, usedTools: invalidTools },
        'session123'
      );
      resultWithInvalidTools.setAppendFn(mockAppendFn);

      await resultWithInvalidTools.save({ saveToolMessages: true });

      expect(mockAppendFn).not.toHaveBeenCalled();
    });

    it('should save the results of parallel tool calls', async () => {
      const result = new GenerateResultMessages(
        mockDirectMessages,
        mockAugmentedContext,
        { ...mockLlmResponse, usedTools: parallelTools },
        'session123'
      );
      result.setAppendFn(mockAppendFn);

      await result.save({ saveToolMessages: true });

      expect(mockAppendFn.mock.calls[0][1]).toEqual(parallelTools);
    });

    it('should save valid tools with specific indices', async () => {
      await generateResultMessages.save({ saveToolMessages: [0, 1] });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(2);
    });

    it('should handle no tools with saveToolMessages: true', async () => {
      const resultWithNoTools = new GenerateResultMessages(
        mockDirectMessages,
        mockAugmentedContext,
        { ...mockLlmResponse, usedTools: [] },
        'session123'
      );
      resultWithNoTools.setAppendFn(mockAppendFn);

      await resultWithNoTools.save({ saveToolMessages: true });

      expect(mockAppendFn).not.toHaveBeenCalled();
    });
  });

  describe('save() - Edge Cases', () => {
    it('should handle empty message arrays', async () => {
      const resultWithEmptyArrays = new GenerateResultMessages(
        [],
        [],
        { ...mockLlmResponse, usedTools: [] },
        'session123'
      );
      resultWithEmptyArrays.setAppendFn(mockAppendFn);

      await resultWithEmptyArrays.save({ saveAssistantMessage: true });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(1);
    });

    it('should throw error when appendFn not set', async () => {
      const resultWithoutAppendFn = new GenerateResultMessages(
        mockDirectMessages,
        mockAugmentedContext,
        mockLlmResponse,
        'session123'
      );

      await expect(resultWithoutAppendFn.save()).rejects.toThrow('Batch append function not set');
    });

    it('should propagate appendFn errors', async () => {
      const errorAppendFn = vi.fn().mockRejectedValue(new Error('Save failed'));
      generateResultMessages.setAppendFn(errorAppendFn);

      await expect(generateResultMessages.save({ saveAssistantMessage: true })).rejects.toThrow('Save failed');
    });
  });

  describe('save() - Undefined Options', () => {
    it('should handle undefined mixed with defined options', async () => {
      await generateResultMessages.save({
        saveAugmentedContext: undefined,
        saveDirectMessages: true
      });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(3); // only direct messages
      expect(savedMessages).toEqual(mockDirectMessages);
    });
  });

  describe('save() - Message Sequence Verification', () => {
    it('should maintain correct sequence: directMessages � augmentedContext � usedTools � assistant', async () => {
      await generateResultMessages.save({
        saveDirectMessages: true,
        saveAugmentedContext: true,
        saveToolMessages: true,
        saveAssistantMessage: true
      });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(9);

      // Verify sequence: directMessages → augmentedContext → usedTools → assistant
      expect(savedMessages.slice(0, 3)).toEqual(mockDirectMessages);
      expect(savedMessages.slice(3, 6)).toEqual(mockAugmentedContext);
      expect(savedMessages.slice(6, 8)).toEqual(mockUsedTools);
      expect(savedMessages[8]).toEqual(mockLlmResponse.topChoice);
    });

    it('should maintain sequence for partial selection 1', async () => {
      await generateResultMessages.save({
        saveDirectMessages: true,
        saveAssistantMessage: true
      });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(4);

      // Verify sequence: direct messages first, then assistant
      expect(savedMessages.slice(0, 3)).toEqual(mockDirectMessages);
      expect(savedMessages[3]).toEqual(mockLlmResponse.topChoice);
    });

    it('should maintain sequence for partial selection 2', async () => {
      await generateResultMessages.save({
        saveAugmentedContext: true,
        saveToolMessages: true
      });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(5);

      // Verify sequence: augmented first, then tools
      expect(savedMessages.slice(0, 3)).toEqual(mockAugmentedContext);
      expect(savedMessages.slice(3, 5)).toEqual(mockUsedTools);
    });

    it('should maintain sequence with index-based selection', async () => {
      await generateResultMessages.save({
        saveDirectMessages: [0, 2],
        saveAugmentedContext: [1],
        saveToolMessages: [0],
        saveAssistantMessage: true
      });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(5);

      // Verify sequence is maintained
      expect(savedMessages[0]).toEqual(mockDirectMessages[0]);
      expect(savedMessages[1]).toEqual(mockDirectMessages[2]);
      expect(savedMessages[2]).toEqual(mockAugmentedContext[1]);
      expect(savedMessages[3]).toEqual(mockUsedTools[0]);
      expect(savedMessages[4]).toEqual(mockLlmResponse.topChoice);
    });

    it('should maintain sequence with interleaved options', async () => {
      await generateResultMessages.save({
        saveDirectMessages: [1],
        saveAugmentedContext: true,
        saveToolMessages: [1],
        saveAssistantMessage: true
      });

      const savedMessages = mockAppendFn.mock.calls[0][1];

      // Find positions of each type
      const directIndex = savedMessages.findIndex((msg: any) => msg.id === 'direct2');
      const augmentedStartIndex = savedMessages.findIndex((msg: any) => msg.id === 'aug1');
      const toolIndex = savedMessages.findIndex((msg: any) => msg.id === 'tool2');
      const assistantIndex = savedMessages.findIndex((msg: any) => msg.id === 'assistant1');

      // Verify sequence order
      expect(directIndex).toBeLessThan(augmentedStartIndex);
      expect(augmentedStartIndex).toBeLessThan(toolIndex);
      expect(toolIndex).toBeLessThan(assistantIndex);
    });

    it('should maintain sequence for single message type', async () => {
      await generateResultMessages.save({ saveAugmentedContext: [0, 2] });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(2);
      expect(savedMessages[0]).toEqual(mockAugmentedContext[0]);
      expect(savedMessages[1]).toEqual(mockAugmentedContext[2]);
    });

    it('should maintain sequence when some arrays are empty', async () => {
      await generateResultMessages.save({
        saveDirectMessages: [],
        saveAugmentedContext: [1],
        saveToolMessages: true,
        saveAssistantMessage: true
      });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(4); // aug[1] + tools[2] + assistant[1]

      expect(savedMessages[0]).toEqual(mockAugmentedContext[1]);
      expect(savedMessages.slice(1, 3)).toEqual(mockUsedTools);
      expect(savedMessages[3]).toEqual(mockLlmResponse.topChoice);
    });

    it('should maintain sequence with mixed boolean/array options', async () => {
      await generateResultMessages.save({
        saveDirectMessages: true,
        saveAugmentedContext: [2],
        saveToolMessages: false,
        saveAssistantMessage: true
      });

      const savedMessages = mockAppendFn.mock.calls[0][1];

      // Verify direct messages come before augmented, augmented before assistant
      const lastDirectIndex = 2; // last direct message index
      const augmentedIndex = savedMessages.findIndex((msg: any) => msg.id === 'aug3');
      const assistantIndex = savedMessages.findIndex((msg: any) => msg.id === 'assistant1');

      expect(lastDirectIndex).toBeLessThan(augmentedIndex);
      expect(augmentedIndex).toBeLessThan(assistantIndex);
    });

    it('should maintain sequence when tool validation fails', async () => {
      const invalidTools: UsedToolMessage[] = [
        {
          id: 'tool1',
          sessionId: 'session123',
          ctx: {},
          content: [toolCall('call-1')],
          role: Type.LLM.UnifiedMessageRole.assistant,
          author: 'test-assistant',
          llmName: 'test-llm',
          manifestName: 'test-manifest',
          llmIgnore: false,
          setAppendFn: () => {},
          append: async () => ({}) as any
        }
      ];

      const resultWithInvalidTools = new GenerateResultMessages(
        mockDirectMessages,
        mockAugmentedContext,
        { ...mockLlmResponse, usedTools: invalidTools },
        'session123'
      );
      resultWithInvalidTools.setAppendFn(mockAppendFn);

      await resultWithInvalidTools.save({
        saveDirectMessages: [0],
        saveAugmentedContext: [0],
        saveToolMessages: true,
        saveAssistantMessage: true
      });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(3); // direct + augmented + assistant (tools skipped)

      expect(savedMessages[0]).toEqual(mockDirectMessages[0]);
      expect(savedMessages[1]).toEqual(mockAugmentedContext[0]);
      expect(savedMessages[2]).toEqual(mockLlmResponse.topChoice);
    });

    it('should handle duplicate indices in sequence', async () => {
      await generateResultMessages.save({
        saveDirectMessages: [0, 0, 1],
        saveAugmentedContext: [1, 1],
        saveAssistantMessage: true
      });

      const savedMessages = mockAppendFn.mock.calls[0][1];

      // Should include duplicates
      expect(savedMessages[0]).toEqual(mockDirectMessages[0]);
      expect(savedMessages[1]).toEqual(mockDirectMessages[0]);
      expect(savedMessages[2]).toEqual(mockDirectMessages[1]);
      expect(savedMessages[3]).toEqual(mockAugmentedContext[1]);
      expect(savedMessages[4]).toEqual(mockAugmentedContext[1]);
      expect(savedMessages[5]).toEqual(mockLlmResponse.topChoice);
    });

    it('should maintain sequence with out-of-bounds indices', async () => {
      await generateResultMessages.save({
        saveDirectMessages: [0, 10, 1],
        saveAugmentedContext: [0, 20],
        saveAssistantMessage: true
      });

      const savedMessages = mockAppendFn.mock.calls[0][1];
      expect(savedMessages).toHaveLength(4); // valid indices only

      expect(savedMessages[0]).toEqual(mockDirectMessages[0]);
      expect(savedMessages[1]).toEqual(mockDirectMessages[1]);
      expect(savedMessages[2]).toEqual(mockAugmentedContext[0]);
      expect(savedMessages[3]).toEqual(mockLlmResponse.topChoice);
    });
  });
});
