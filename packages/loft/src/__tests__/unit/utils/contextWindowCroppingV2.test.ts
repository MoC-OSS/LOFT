import { Interface, Type } from '@moc-global/loft-definitions';
import { configureSpyLoggerStrategy } from '@moc-global/loft-test-suite';
import { describe, expect, it } from 'vitest';

import { cropChatHistorySafely, findSafeCropPoint } from '../../../utils/contextWindowCroppingV2';

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

describe('contextWindowCroppingV2', () => {
  describe('findSafeCropPoint', () => {
    it('should return full array when target size is larger than array', () => {
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '2')
      ];

      const result = findSafeCropPoint(messages, 5);

      expect(result).toEqual({
        startIndex: 0,
        includedCount: 2,
        wasAdjusted: false
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

      const result = findSafeCropPoint(messages, 3);

      expect(result.startIndex).toBe(2); // Start from user message '3'
      expect(result.includedCount).toBe(3);
      expect(result.wasAdjusted).toBe(false);
    });

    it('V2 KEY FIX: should allow cropping before Assistant after Tool (completed tool chain)', () => {
      /*
      Vertical diagram showing this scenario:
      ┌─ User: "Help me with search"
      ├─ Assistant+tools: [tool_call]
      ├─ Tool: result
      ├─ Assistant: "Here's the answer"  ← V2: This is SAFE to crop before ✅
      └─ User: "Thanks!"

      Old algorithm incorrectly marked this as unsafe.
      V2 correctly identifies that Assistant without tools after Tool is safe.
      */
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createToolCallMessage('2'), // assistant with tool_calls
        createToolResultMessage('3'), // corresponding tool result
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '4'), // ✅ V2: Safe to crop before this
        createMessage(Type.LLM.UnifiedMessageRole.user, '5')
      ];

      const result = findSafeCropPoint(messages, 2);

      // V2 should allow cropping before Assistant message without tools (even after Tool)
      expect(result.startIndex).toBe(3); // Start from assistant without tools
      expect(result.includedCount).toBe(2);
      expect(result.wasAdjusted).toBe(false); // No adjustment needed
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

      const result = findSafeCropPoint(messages, 2);

      // Should go back to safe point (beginning) since can't crop before assistant with tools
      expect(result.startIndex).toBe(0); // Must go back to beginning
      expect(result.includedCount).toBe(4); // Include all messages
      expect(result.wasAdjusted).toBe(true);
      expect(result.adjustmentReason).toContain('tool chain integrity');
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

      const result = findSafeCropPoint(messages, 2);

      // Should go back to safe point since can't crop before tool message
      expect(result.startIndex).toBe(0);
      expect(result.includedCount).toBe(4);
      expect(result.wasAdjusted).toBe(true);
    });

    it('V2 IMPROVEMENT: handles complex tool chains with Assistant after Tool correctly', () => {
      /*
      Complex vertical diagram:
      ┌─ User: "Search for items"
      ├─ Assistant+tools: [search_tool]
      ├─ Tool: search_results
      ├─ Assistant+tools: [analyze_tool]
      ├─ Tool: analysis_results
      ├─ Assistant: "Based on analysis..." ← ✅ V2: Safe to crop before this
      └─ User: "Great, now what?"

      Target: 3 messages
      V2 should correctly identify that cropping before final Assistant is safe.
      */
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createToolCallMessage('2'), // First tool chain
        createToolResultMessage('3'),
        createToolCallMessage('4'), // Second tool chain
        createToolResultMessage('5'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '6'), // ✅ V2: Safe
        createMessage(Type.LLM.UnifiedMessageRole.user, '7')
      ];

      const result = findSafeCropPoint(messages, 3);

      // V2 should find the safe crop point before assistant without tools
      expect(result.startIndex).toBe(0); // Must include all to avoid breaking tool chains
      expect(result.includedCount).toBe(7); // All messages included
      expect(result.wasAdjusted).toBe(true);
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

      const result = findSafeCropPoint(messages, 2);

      expect(result.startIndex).toBe(1); // Can start from system or user
      expect(result.includedCount).toBe(2);
    });

    it('should handle edge case with targetSize = 0', () => {
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '2')
      ];

      const result = findSafeCropPoint(messages, 0);

      // Should use fallback strategy since targetSize is 0
      expect(result.wasAdjusted).toBe(true);
      expect(result.includedCount).toBeGreaterThan(0);
      expect(result.adjustmentReason).toContain('Invalid targetSize');
    });

    it('should handle negative targetSize gracefully', () => {
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '2')
      ];

      const result = findSafeCropPoint(messages, -5);

      expect(result.wasAdjusted).toBe(true);
      expect(result.includedCount).toBeGreaterThan(0);
      expect(result.adjustmentReason).toContain('Invalid targetSize');
    });

    it('V2 DEMONSTRATION: shows difference between safe and unsafe Assistant messages', () => {
      /*
      Vertical diagram showing the V2 logic difference:
      ┌─ User: "Help me"
      ├─ Assistant+tools: [tool_call] ← ❌ UNSAFE (has tool_calls)
      ├─ Tool: result
      ├─ Assistant: "Here's the answer" ← ✅ SAFE (no tool_calls, even after Tool)
      └─ User: "Thanks"

      This test demonstrates the key V2 improvement.
      */
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createToolCallMessage('2'), // ❌ Assistant WITH tools
        createToolResultMessage('3'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '4'), // ✅ Assistant WITHOUT tools
        createMessage(Type.LLM.UnifiedMessageRole.user, '5')
      ];

      // Test 1: Try to crop at unsafe Assistant+tools (index 1)
      const unsafeResult = findSafeCropPoint(messages, 4); // Would ideally start at index 1
      expect(unsafeResult.startIndex).toBe(0); // Goes back to beginning (safe)
      expect(unsafeResult.wasAdjusted).toBe(true);

      // Test 2: Try to crop at safe Assistant without tools (index 3)
      const safeResult = findSafeCropPoint(messages, 2); // Should start at index 3
      expect(safeResult.startIndex).toBe(3); // ✅ V2: Allows cropping before Assistant without tools
      expect(safeResult.wasAdjusted).toBe(false); // No adjustment needed
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

      const result = findSafeCropPoint(messages, 3);

      // Should avoid cropping before assistant with tool_calls
      expect(result.startIndex).toBe(0);
      expect(result.wasAdjusted).toBe(true);
    });

    it('should handle empty content arrays gracefully', () => {
      const emptyContentMessage = createMessage(Type.LLM.UnifiedMessageRole.assistant, '2', []);

      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        emptyContentMessage, // ✅ Assistant with empty content (no tool_calls)
        createMessage(Type.LLM.UnifiedMessageRole.user, '3')
      ];

      const result = findSafeCropPoint(messages, 2);

      // Should handle empty content gracefully - assistant without tool_calls is safe
      expect(result.startIndex).toBe(1);
      expect(result.wasAdjusted).toBe(false);
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

      const result = findSafeCropPoint(messages, 2);

      expect(result.startIndex).toBe(1);
      expect(result.wasAdjusted).toBe(false);
    });

    it('V2 REGRESSION TEST: ensures backward-only search never searches forward', () => {
      /*
      This test ensures V2 never searches forward from idealStartIndex.
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

      const result = findSafeCropPoint(messages, 3);

      // Should start exactly at idealStartIndex since it's safe
      expect(result.startIndex).toBe(1); // Never goes forward beyond idealStartIndex
      expect(result.includedCount).toBe(3);
      expect(result.wasAdjusted).toBe(false);
    });

    it('V2 EDGE CASE: handles array with only tool messages', () => {
      const messages = [createToolResultMessage('1'), createToolResultMessage('2'), createToolResultMessage('3')];

      const result = findSafeCropPoint(messages, 2);

      // Should trigger emergency since all messages are tool messages (unsafe)
      expect(result.wasAdjusted).toBe(true);
      expect(result.startIndex).toBe(0); // Keep all messages
      expect(result.includedCount).toBe(3);
      expect(result.adjustmentReason).toContain('EMERGENCY: No safe crop point found');
    });
  });

  describe('cropChatHistorySafely', () => {
    it('should return original array when no cropping needed', () => {
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '2')
      ];

      const result = cropChatHistorySafely(messages, 5);

      expect(result).toHaveLength(2);
      expect(result).not.toBe(messages); // Should return a new array
      expect(result).toEqual(messages);
    });

    it('V2: should log with "V2" identifier to distinguish from old algorithm', () => {
      const spyLoggerStrategy = configureSpyLoggerStrategy();

      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '2'),
        createMessage(Type.LLM.UnifiedMessageRole.user, '3')
      ];

      const result = cropChatHistorySafely(messages, 2);

      expect(result).toHaveLength(2);
      expect(spyLoggerStrategy.debug).toHaveBeenCalledWith(
        'Chat history cropped (V2)', // ✅ V2 identifier in logs
        'ContextWindowCropping',
        expect.objectContaining({
          originalCount: 3,
          targetSize: 2,
          actualCount: 2,
          wasAdjusted: false
        })
      );
    });

    it('V2: should handle Assistant after Tool correctly', () => {
      /*
      Vertical diagram of successful V2 scenario:
      ┌─ User: "Help me search"
      ├─ Assistant+tools: [search_tool]
      ├─ Tool: results
      ├─ Assistant: "Here are results" ← V2: Safe crop point ✅
      └─ User: "Thanks!"
      */
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createToolCallMessage('2'),
        createToolResultMessage('3'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '4'), // ✅ Safe
        createMessage(Type.LLM.UnifiedMessageRole.user, '5')
      ];

      const result = cropChatHistorySafely(messages, 2);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('4'); // Starts from safe assistant message
      expect(result[1].id).toBe('5');
    });

    it('should crop messages correctly', () => {
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '2'),
        createMessage(Type.LLM.UnifiedMessageRole.user, '3')
      ];

      const result = cropChatHistorySafely(messages, 2);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('2');
      expect(result[1].id).toBe('3');
    });

    it('should handle tool chain imbalance when detected', () => {
      // Create messages with imbalanced tool chains
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createToolCallMessage('2'), // Assistant with tool_call
        createToolResultMessage('3'), // Tool result
        createToolCallMessage('4'), // Another assistant with tool_call
        // Missing tool result for the second call
        createMessage(Type.LLM.UnifiedMessageRole.user, '5')
      ];

      const result = cropChatHistorySafely(messages, 3);

      // Algorithm will avoid cropping before assistant with tool_calls, so keeps all 5 messages
      expect(result).toHaveLength(5);
      expect(result[0].id).toBe('1');
    });

    it('should handle incomplete tool chain at the end', () => {
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '2'),
        createMessage(Type.LLM.UnifiedMessageRole.user, '3'),
        createToolCallMessage('4') // Assistant with tool_call at the end
      ];

      const result = cropChatHistorySafely(messages, 2);

      // Should crop keeping last 2 messages
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('3');
      expect(result[1].id).toBe('4');
    });

    it('V2 COMPREHENSIVE TEST: demonstrates all V2 improvements', () => {
      /*
      Full vertical scenario showing V2 improvements:
      ┌─ User: "Start search"
      ├─ Assistant+tools: [tool1] ← ❌ Unsafe (has tools)
      ├─ Tool: result1
      ├─ Assistant+tools: [tool2] ← ❌ Unsafe (has tools)
      ├─ Tool: result2
      ├─ Assistant: "Analysis complete" ← ✅ V2: Safe (no tools, even after Tool)
      ├─ User: "Great results"
      └─ Assistant: "Glad to help"

      Target: 3 messages
      V2 should crop at the safe Assistant message.
      */
      const messages = [
        createMessage(Type.LLM.UnifiedMessageRole.user, '1'),
        createToolCallMessage('2'), // ❌ Unsafe
        createToolResultMessage('3'),
        createToolCallMessage('4'), // ❌ Unsafe
        createToolResultMessage('5'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '6'), // ✅ V2: Safe!
        createMessage(Type.LLM.UnifiedMessageRole.user, '7'),
        createMessage(Type.LLM.UnifiedMessageRole.assistant, '8')
      ];

      const result = cropChatHistorySafely(messages, 3);

      // V2 should successfully crop at the safe Assistant message
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('6'); // Starts from safe assistant
      expect(result[1].id).toBe('7');
      expect(result[2].id).toBe('8');
    });
  });
});
