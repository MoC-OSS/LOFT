import { Interface, Type } from '@moc-global/loft-definitions';
import { configureMockLoggerStrategy } from '@moc-global/loft-test-suite';
import { Container } from 'inversify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LlmContextWindowCropper } from '../../../base-components/LlmContextWindowCropper';

// Mock message helper
const createMessage = (
  role: Type.LLM.UnifiedMessageRole,
  id: string,
  content?: any[]
): Interface.FacadeEntity.Message =>
  ({
    id,
    role,
    content: content || [{ type: 'text', text: 'test message' }],
    sessionId: 'test-session',
    author: 'test-author',
    llmIgnore: false,
    createdAt: new Date(),
    updatedAt: new Date()
  }) as Interface.FacadeEntity.Message;

const createToolCallMessage = (id: string): Interface.FacadeEntity.Message =>
  createMessage(Type.LLM.UnifiedMessageRole.assistant, id, [
    { type: 'tool_call', id: 'call_123', function: { name: 'test_tool' } }
  ]);

const createToolResultMessage = (id: string): Interface.FacadeEntity.Message =>
  createMessage(Type.LLM.UnifiedMessageRole.tool, id, [
    { type: 'tool_result', call_id: 'call_123', content: 'result' }
  ]);

describe('LlmContextWindowCropper', () => {
  let container: Container;
  let cropper: LlmContextWindowCropper;
  const mockLoggerStrategy = configureMockLoggerStrategy(Interface.LogLevel.DEBUG);

  beforeEach(() => {
    vi.clearAllMocks();
    container = new Container();
    container.bind<LlmContextWindowCropper>(LlmContextWindowCropper).toSelf();
    cropper = container.get<LlmContextWindowCropper>(LlmContextWindowCropper);
  });

  describe('crop', () => {
    it('should return all messages when targetSize is 0', () => {
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '2'),
        createMessage(Type.LLM.UnifiedMessageRole.user, '3')
      ];

      const result = cropper.crop(messages, 0);

      expect(result).toHaveLength(3);
      expect(result).toEqual(messages);
      expect(mockLoggerStrategy.debug).toHaveBeenCalledWith('No cropping needed', 'LlmContextWindowCropper', {
        totalMessages: 3,
        targetSize: 0
      });
    });

    it('should return all messages when targetSize is negative', () => {
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '2')
      ];

      const result = cropper.crop(messages, -5);

      expect(result).toHaveLength(2);
      expect(result).toEqual(messages);
      expect(mockLoggerStrategy.debug).toHaveBeenCalledWith('No cropping needed', 'LlmContextWindowCropper', {
        totalMessages: 2,
        targetSize: -5
      });
    });

    it('should return all messages when messages count is less than targetSize', () => {
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '2')
      ];

      const result = cropper.crop(messages, 5);

      expect(result).toHaveLength(2);
      expect(result).toEqual(messages);
      expect(mockLoggerStrategy.debug).toHaveBeenCalledWith('No cropping needed', 'LlmContextWindowCropper', {
        totalMessages: 2,
        targetSize: 5
      });
    });

    it('should find safe crop point before user message', () => {
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '2'),
        createMessage(Type.LLM.UnifiedMessageRole.user, '3'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '4'),
        createMessage(Type.LLM.UnifiedMessageRole.user, '5')
      ];

      const result = cropper.crop(messages, 3);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('3'); // Start from user message '3'
      expect(result[1].id).toBe('4');
      expect(result[2].id).toBe('5');
    });

    it('should allow cropping before Assistant after Tool (completed tool chain)', () => {
      /*
      Vertical diagram showing this scenario:
      ┌─ User: "Help me with search"
      ├─ Assistant+tools: [tool_call]
      ├─ Tool: result
      ├─ Assistant: "Here's the answer"  ← This is SAFE to crop before ✅
      └─ User: "Thanks!"
      */
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createToolCallMessage('2'), // assistant with tool_calls
        createToolResultMessage('3'), // corresponding tool result
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '4'), // ✅ Safe to crop before this
        createMessage(Type.LLM.UnifiedMessageRole.user, '5')
      ];

      const result = cropper.crop(messages, 2);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('4'); // Start from assistant without tools
      expect(result[1].id).toBe('5');
    });

    it('should NOT allow cropping before Assistant with tool_calls (unsafe)', () => {
      /*
      Vertical diagram:
      ┌─ User: "Help me"
      ├─ Assistant+tools: [tool_call] ← ❌ Unsafe to crop before this
      ├─ Tool: result
      └─ User: "Thanks"
      */
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createToolCallMessage('2'), // ❌ assistant with tool_calls - unsafe
        createToolResultMessage('3'),
        createMessage(Type.LLM.UnifiedMessageRole.user, '4')
      ];

      const result = cropper.crop(messages, 2);

      // Should go back to safe point (beginning) since can't crop before assistant with tools
      expect(result).toHaveLength(4); // Include all messages
      expect(mockLoggerStrategy.warn).toHaveBeenCalledWith(
        'Chat history cropped',
        'LlmContextWindowCropper',
        expect.objectContaining({
          wasAdjusted: true,
          adjustmentReason: expect.stringContaining('tool chain integrity')
        })
      );
    });

    it('should NOT allow cropping before Tool messages (orphaned results)', () => {
      /*
      Vertical diagram:
      ┌─ User: "Help me"
      ├─ Assistant+tools: [tool_call]
      ├─ Tool: result ← ❌ Unsafe to crop before this (orphaned result)
      └─ User: "Thanks"
      */
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createToolCallMessage('2'),
        createToolResultMessage('3'), // ❌ Tool message - unsafe to crop before
        createMessage(Type.LLM.UnifiedMessageRole.user, '4')
      ];

      const result = cropper.crop(messages, 2);

      // Should go back to safe point since can't crop before tool message
      expect(result).toHaveLength(4);
      expect(mockLoggerStrategy.warn).toHaveBeenCalledWith(
        'Chat history cropped',
        'LlmContextWindowCropper',
        expect.objectContaining({
          wasAdjusted: true
        })
      );
    });

    it('should handle complex tool chains with Assistant after Tool correctly', () => {
      /*
      Complex vertical diagram:
      ┌─ User: "Search for items"
      ├─ Assistant+tools: [search_tool]
      ├─ Tool: search_results
      ├─ Assistant+tools: [analyze_tool]
      ├─ Tool: analysis_results
      ├─ Assistant: "Based on analysis..." ← ✅ Safe to crop before this
      └─ User: "Great, now what?"

      Target: 3 messages
      */
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createToolCallMessage('2'), // First tool chain
        createToolResultMessage('3'),
        createToolCallMessage('4'), // Second tool chain
        createToolResultMessage('5'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '6'), // ✅ Safe
        createMessage(Type.LLM.UnifiedMessageRole.user, '7')
      ];

      const result = cropper.crop(messages, 3);

      // Should include all to avoid breaking tool chains
      expect(result).toHaveLength(7);
      expect(mockLoggerStrategy.warn).toHaveBeenCalledWith(
        'Chat history cropped',
        'LlmContextWindowCropper',
        expect.objectContaining({
          wasAdjusted: true
        })
      );
    });

    it('should handle system messages gracefully', () => {
      /*
      Vertical diagram:
      ┌─ System: "You are a helpful assistant" ← ✅ Safe
      ├─ User: "Help me"
      └─ Assistant: "Sure!"
      */
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.system, '1'),
        createMessage(Type.LLM.UnifiedMessageRole.user, '2'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '3')
      ];

      const result = cropper.crop(messages, 2);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('2'); // Can start from user
      expect(result[1].id).toBe('3');
    });

    it('should demonstrate difference between safe and unsafe Assistant messages', () => {
      /*
      Vertical diagram showing the logic difference:
      ┌─ User: "Help me"
      ├─ Assistant+tools: [tool_call] ← ❌ UNSAFE (has tool_calls)
      ├─ Tool: result
      ├─ Assistant: "Here's the answer" ← ✅ SAFE (no tool_calls, even after Tool)
      └─ User: "Thanks"
      */
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createToolCallMessage('2'), // ❌ Assistant WITH tools
        createToolResultMessage('3'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '4'), // ✅ Assistant WITHOUT tools
        createMessage(Type.LLM.UnifiedMessageRole.user, '5')
      ];

      // Try to crop at safe Assistant without tools
      const result = cropper.crop(messages, 2);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('4'); // ✅ Allows cropping before Assistant without tools
      expect(result[1].id).toBe('5');
    });

    it('should handle multiple tool calls in single assistant message', () => {
      const multipleToolCallsMessage = createMessage(Type.LLM.UnifiedMessageRole.assistant, '2', [
        { type: 'tool_call', id: 'call_1', function: { name: 'tool1' } },
        { type: 'tool_call', id: 'call_2', function: { name: 'tool2' } }
      ]);

      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        multipleToolCallsMessage, // ❌ Assistant with multiple tool_calls
        createToolResultMessage('3'),
        createToolResultMessage('4'),
        createMessage(Type.LLM.UnifiedMessageRole.user, '5')
      ];

      const result = cropper.crop(messages, 3);

      // Should avoid cropping before assistant with tool_calls
      expect(result).toHaveLength(5);
      expect(mockLoggerStrategy.warn).toHaveBeenCalledWith(
        'Chat history cropped',
        'LlmContextWindowCropper',
        expect.objectContaining({
          wasAdjusted: true
        })
      );
    });

    it('should handle empty content arrays gracefully', () => {
      const emptyContentMessage = createMessage(Type.LLM.UnifiedMessageRole.assistant, '2', []);

      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        emptyContentMessage, // ✅ Assistant with empty content (no tool_calls)
        createMessage(Type.LLM.UnifiedMessageRole.user, '3')
      ];

      const result = cropper.crop(messages, 2);

      // Should handle empty content gracefully - assistant without tool_calls is safe
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('2');
      expect(result[1].id).toBe('3');
    });

    it('should handle null content gracefully', () => {
      const nullContentMessage = {
        ...createMessage(Type.LLM.UnifiedMessageRole.assistant, '2'),
        content: null as any
      } as Interface.FacadeEntity.Message;

      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        nullContentMessage, // ✅ Assistant with null content (no tool_calls)
        createMessage(Type.LLM.UnifiedMessageRole.user, '3')
      ];

      const result = cropper.crop(messages, 2);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('2');
      expect(result[1].id).toBe('3');
    });

    it('should ensure backward-only search never searches forward', () => {
      /*
      This test ensures never searches forward from idealStartIndex.
      Only backward search is allowed to increase context size when needed.

      Vertical diagram:
      ┌─ User: "Help"
      ├─ Assistant: "Sure" ← Target would be here (index 1)
      ├─ User: "More help" ← Forward search would go here (❌ Never allowed)
      └─ Assistant: "Of course"
      */
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '2'), // idealStartIndex for targetSize=3
        createMessage(Type.LLM.UnifiedMessageRole.user, '3'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '4')
      ];

      const result = cropper.crop(messages, 3);

      // Should start exactly at idealStartIndex since it's safe
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('2'); // Never goes forward beyond idealStartIndex
      expect(result[1].id).toBe('3');
      expect(result[2].id).toBe('4');
    });

    it('should handle array with only tool messages', () => {
      const messages = [createToolResultMessage('1'), createToolResultMessage('2'), createToolResultMessage('3')];

      const result = cropper.crop(messages, 2);

      // Should trigger emergency since all messages are tool messages (unsafe)
      expect(result).toHaveLength(3); // Keep all messages
      expect(mockLoggerStrategy.warn).toHaveBeenCalledWith(
        'EMERGENCY: No safe crop point found in chat history',
        'LlmContextWindowCropper',
        expect.objectContaining({
          totalMessages: 3,
          targetSize: 2
        })
      );
    });

    it('should warn about orphaned tool message at the beginning', () => {
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '2'),
        createToolResultMessage('3'), // Orphaned tool result
        createMessage(Type.LLM.UnifiedMessageRole.user, '4')
      ];

      const result = cropper.crop(messages, 2);

      // Algorithm finds safe crop point at assistant without tools (index 1), so returns 3 messages
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('2'); // Starts from safe assistant message
      expect(result[1].id).toBe('3');
      expect(result[2].id).toBe('4');

      expect(mockLoggerStrategy.warn).toHaveBeenCalledWith(
        'Tool chain imbalance detected',
        'LlmContextWindowCropper',
        expect.objectContaining({
          toolCallCount: 0,
          toolResultCount: 1,
          difference: -1,
          issue: 'More tool results than calls - some results may be orphaned'
        })
      );
    });

    it('should warn about incomplete tool chain at the end', () => {
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '2'),
        createMessage(Type.LLM.UnifiedMessageRole.user, '3'),
        createToolCallMessage('4') // Assistant with tool_call at the end
      ];

      const result = cropper.crop(messages, 2);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('3');
      expect(result[1].id).toBe('4');

      // Should warn about incomplete tool chain at the end
      expect(mockLoggerStrategy.warn).toHaveBeenCalledWith(
        'Cropped result ends with incomplete tool chain',
        'LlmContextWindowCropper',
        expect.objectContaining({
          lastMessageId: '4',
          issue: 'Assistant message with tool_calls but no corresponding tool results'
        })
      );

      // Should also warn about tool chain imbalance
      expect(mockLoggerStrategy.warn).toHaveBeenCalledWith(
        'Tool chain imbalance detected',
        'LlmContextWindowCropper',
        expect.objectContaining({
          toolCallCount: 1,
          toolResultCount: 0,
          difference: 1,
          issue: 'More tool calls than results - some calls may be missing responses'
        })
      );
    });

    it('should warn about tool chain imbalance when detected', () => {
      // Create messages with imbalanced tool chains
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createToolCallMessage('2'), // Assistant with tool_call
        createToolResultMessage('3'), // Tool result
        createToolCallMessage('4'), // Another assistant with tool_call
        // Missing tool result for the second call
        createMessage(Type.LLM.UnifiedMessageRole.user, '5')
      ];

      const result = cropper.crop(messages, 3);

      // Algorithm will avoid cropping before assistant with tool_calls, so keeps all 5 messages
      expect(result).toHaveLength(5);
      expect(result[0].id).toBe('1');

      // Should warn about tool chain imbalance (2 calls, 1 result)
      expect(mockLoggerStrategy.warn).toHaveBeenCalledWith(
        'Tool chain imbalance detected',
        'LlmContextWindowCropper',
        expect.objectContaining({
          toolCallCount: 2, // Two assistants with tool_calls
          toolResultCount: 1, // One tool result
          difference: 1,
          issue: 'More tool calls than results - some calls may be missing responses'
        })
      );
    });

    it('should demonstrate comprehensive improvements', () => {
      /*
      Full vertical scenario:
      ┌─ User: "Start search"
      ├─ Assistant+tools: [tool1] ← ❌ Unsafe (has tools)
      ├─ Tool: result1
      ├─ Assistant+tools: [tool2] ← ❌ Unsafe (has tools)
      ├─ Tool: result2
      ├─ Assistant: "Analysis complete" ← ✅ Safe (no tools, even after Tool)
      ├─ User: "Great results"
      └─ Assistant: "Glad to help"

      Target: 3 messages
      */
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createToolCallMessage('2'), // ❌ Unsafe
        createToolResultMessage('3'),
        createToolCallMessage('4'), // ❌ Unsafe
        createToolResultMessage('5'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '6'), // ✅ Safe!
        createMessage(Type.LLM.UnifiedMessageRole.user, '7'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '8')
      ];

      const result = cropper.crop(messages, 3);

      // Should successfully crop at the safe Assistant message
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('6'); // Starts from safe assistant
      expect(result[1].id).toBe('7');
      expect(result[2].id).toBe('8');

      // Should log successful cropping
      expect(mockLoggerStrategy.debug).toHaveBeenCalledWith(
        'Chat history cropped',
        'LlmContextWindowCropper',
        expect.objectContaining({
          originalCount: 8,
          targetSize: 3,
          actualCount: 3,
          wasAdjusted: false // Found exact target without adjustment
        })
      );
    });

    it('should handle Assistant after Tool correctly (no warnings)', () => {
      /*
      Vertical diagram of successful scenario:
      ┌─ User: "Help me search"
      ├─ Assistant+tools: [search_tool]
      ├─ Tool: results
      ├─ Assistant: "Here are results" ← Safe crop point ✅
      └─ User: "Thanks!"
      */
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createToolCallMessage('2'),
        createToolResultMessage('3'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '4'), // ✅ Safe
        createMessage(Type.LLM.UnifiedMessageRole.user, '5')
      ];

      const result = cropper.crop(messages, 2);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('4'); // Starts from safe assistant message
      expect(result[1].id).toBe('5');

      // Should not warn about tool chain issues since this is a valid crop
      expect(mockLoggerStrategy.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('tool chain issue'),
        expect.any(Object)
      );
    });

    it('should return a new array copy when no cropping needed', () => {
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '2')
      ];

      const result = cropper.crop(messages, 5);

      expect(result).toHaveLength(2);
      expect(result).not.toBe(messages); // Should return a new array
      expect(result).toEqual(messages);
    });
  });
});
