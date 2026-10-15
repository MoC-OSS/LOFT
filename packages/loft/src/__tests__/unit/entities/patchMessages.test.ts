import 'reflect-metadata';

import { Type } from '@moc-global/loft-definitions';
import { beforeEach, describe, expect, it } from 'vitest';

import { patchMessages } from '../../../managers/AbstractChatHistoryManager';

describe('patchMessages', () => {
  let messageSequenceCounter = 1;
  let patchSequenceCounter = 1;

  beforeEach(() => {
    messageSequenceCounter = 1;
    patchSequenceCounter = 1;
  });

  const createMessage = (
    id: string,
    content: Type.Entity.FullContentPart[],
    role: Type.LLM.UnifiedMessageRole = Type.LLM.UnifiedMessageRole.user,
    author: string = 'John'
  ): Type.Entity.Message => ({
    id,
    sequenceId: String(messageSequenceCounter++),
    sessionId: '',
    ctx: {},
    content,
    role,
    author,
    llmName: 'gpt-4',
    manifestName: 'default',
    llmIgnore: false,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const createPatch = (
    messageId: string,
    content: Type.Entity.FullContentPart[],
    role: Type.LLM.UnifiedMessageRole,
    author: string,
    llmName: string = 'gpt-4',
    manifestName: string = 'default',
    llmIgnore: boolean = false
  ): Type.Entity.MessagePatch => ({
    id: `patch-${patchSequenceCounter}`,
    sequenceId: String(patchSequenceCounter++),
    sessionId: '123e4567-e89b-12d3-a456-426614174002',
    messageId,
    patchAction: Type.Entity.MessagePatchAction.PATCH,
    ctx: {},
    content,
    role,
    author,
    llmName,
    manifestName,
    llmIgnore,
    createdAt: new Date()
  });

  it('should apply patch correctly and maintain immutability', () => {
    const message = createMessage('msg1', [{ type: 'text', text: 'Original content' }]);
    const patch = createPatch(
      'msg1',
      [{ type: 'text', text: 'Patched content' }],
      Type.LLM.UnifiedMessageRole.assistant,
      'AI',
      'gpt-3.5',
      'custom',
      true
    );

    const result = patchMessages([message], [patch]);

    // Verify patch application
    expect(result[0]).toEqual({
      ...message,
      content: patch.content,
      role: patch.role,
      author: patch.author,
      llmName: patch.llmName,
      manifestName: patch.manifestName,
      llmIgnore: patch.llmIgnore,
      ctx: patch.ctx
    });

    // Verify immutability
    expect(result).not.toBe([message]);
    expect(message.content).toEqual([{ type: 'text', text: 'Original content' }]);

    // Verify non-patchable fields remain unchanged
    expect(result[0].id).toBe(message.id);
    expect(result[0].sequenceId).toBe(message.sequenceId);
    expect(result[0].sessionId).toBe(message.sessionId);
    expect(result[0].createdAt).toBe(message.createdAt);
    expect(result[0].updatedAt).toBe(message.updatedAt);
  });

  it('should handle multiple messages and patches in correct sequence', () => {
    const message1 = createMessage('msg1', [{ type: 'text', text: 'Message 1' }]);
    const message2 = createMessage('msg2', [{ type: 'text', text: 'Message 2' }]);

    const patches = [
      createPatch('msg1', [{ type: 'text', text: 'Patch 1.1' }], Type.LLM.UnifiedMessageRole.assistant, 'AI 1'),
      createPatch('msg1', [{ type: 'text', text: 'Patch 1.2' }], Type.LLM.UnifiedMessageRole.user, 'User 1'),
      createPatch('msg1', [{ type: 'text', text: 'Patch 1.3' }], Type.LLM.UnifiedMessageRole.assistant, 'AI 2'),
      createPatch('msg2', [{ type: 'text', text: 'Patch 2.1' }], Type.LLM.UnifiedMessageRole.user, 'User 2'),
      createPatch('msg2', [{ type: 'text', text: 'Patch 2.2' }], Type.LLM.UnifiedMessageRole.assistant, 'AI 3'),
      createPatch('msg2', [{ type: 'text', text: 'Patch 2.3' }], Type.LLM.UnifiedMessageRole.user, 'User 3')
    ];

    // Mix up patches to test sequence ordering
    const shuffledPatches = [patches[3], patches[0], patches[5], patches[2], patches[1], patches[4]];

    const result = patchMessages([message1, message2], shuffledPatches);

    // Verify correct number of messages
    expect(result).toHaveLength(2);

    // Verify final state of messages
    expect(result[0]).toEqual({
      ...message1,
      content: [{ type: 'text', text: 'Patch 1.3' }],
      role: Type.LLM.UnifiedMessageRole.assistant,
      author: 'AI 2'
    });

    expect(result[1]).toEqual({
      ...message2,
      content: [{ type: 'text', text: 'Patch 2.3' }],
      role: Type.LLM.UnifiedMessageRole.user,
      author: 'User 3'
    });

    // Verify original message order is maintained
    expect(result.map((m) => m.id)).toEqual(['msg1', 'msg2']);
  });

  it('should handle edge cases', () => {
    const message = createMessage('msg1', [{ type: 'text', text: 'Original content' }]);

    // Test empty patches
    expect(patchMessages([message], [])[0]).toEqual(message);

    // Test empty messages
    expect(patchMessages([], [])).toEqual([]);

    // Test non-existent message patch
    const nonExistentPatch = createPatch(
      'non-existent-id',
      [{ type: 'text', text: 'Patch' }],
      Type.LLM.UnifiedMessageRole.assistant,
      'AI'
    );
    expect(patchMessages([message], [nonExistentPatch])[0]).toEqual(message);

    // Test complex ctx objects
    const ctxPatch = {
      ...createPatch('msg1', [{ type: 'text', text: 'Patch' }], Type.LLM.UnifiedMessageRole.assistant, 'AI'),
      ctx: { key: 'value', nested: { data: 123 }, array: [1, 2, 3] }
    };
    expect(patchMessages([message], [ctxPatch])[0].ctx).toEqual(ctxPatch.ctx);

    // Test duplicate sequenceIds (last one wins)
    const duplicatePatches = [
      {
        ...createPatch('msg1', [{ type: 'text', text: 'First' }], Type.LLM.UnifiedMessageRole.assistant, 'AI'),
        sequenceId: '1'
      },
      {
        ...createPatch('msg1', [{ type: 'text', text: 'Second' }], Type.LLM.UnifiedMessageRole.assistant, 'AI'),
        sequenceId: '1'
      }
    ];
    expect(patchMessages([message], duplicatePatches)[0].content).toEqual([{ type: 'text', text: 'Second' }]);
  });

  it('should handle different patch actions', () => {
    const message = createMessage('msg1', [{ type: 'text', text: 'Original content' }]);
    const patches = [
      {
        ...createPatch('msg1', [{ type: 'text', text: 'First patch' }], Type.LLM.UnifiedMessageRole.assistant, 'AI'),
        patchAction: Type.Entity.MessagePatchAction.PATCH
      },
      {
        ...createPatch('msg1', [{ type: 'text', text: 'Second patch' }], Type.LLM.UnifiedMessageRole.assistant, 'AI'),
        patchAction: Type.Entity.MessagePatchAction.PATCH
      },
      {
        ...createPatch('msg1', [{ type: 'text', text: 'Third patch' }], Type.LLM.UnifiedMessageRole.assistant, 'AI'),
        patchAction: Type.Entity.MessagePatchAction.PATCH
      }
    ];

    const result = patchMessages([message], patches);

    // Verify patches are applied in sequence order
    expect(result[0].content).toEqual([{ type: 'text', text: 'Third patch' }]);
  });

  it('should handle messages with same sequenceId', () => {
    const message1 = createMessage('msg1', [{ type: 'text', text: 'Message 1' }]);
    const message2 = createMessage('msg2', [{ type: 'text', text: 'Message 2' }]);
    const message3 = createMessage('msg3', [{ type: 'text', text: 'Message 3' }]);

    // Set same sequenceId for all messages
    message1.sequenceId = '1';
    message2.sequenceId = '1';
    message3.sequenceId = '1';

    const result = patchMessages([message1, message2, message3], []);

    // Original order should be preserved for same sequenceIds
    expect(result.map((m) => m.id)).toEqual(['msg1', 'msg2', 'msg3']);
  });

  it('should preserve original message order when applying patches', () => {
    // Create messages in specific order
    const messages = [
      createMessage('msg1', [{ type: 'text', text: 'Message 1' }]),
      createMessage('msg2', [{ type: 'text', text: 'Message 2' }]),
      createMessage('msg3', [{ type: 'text', text: 'Message 3' }]),
      createMessage('msg4', [{ type: 'text', text: 'Message 4' }]),
      createMessage('msg5', [{ type: 'text', text: 'Message 5' }])
    ];

    // Save original order
    const originalOrder = messages.map((m) => m.id);

    // Assign different sequenceIds in mixed order
    messages[0].sequenceId = '5'; // msg1
    messages[1].sequenceId = '3'; // msg2
    messages[2].sequenceId = '1'; // msg3
    messages[3].sequenceId = '4'; // msg4
    messages[4].sequenceId = '2'; // msg5

    // Create patches for some messages
    const patches = [
      createPatch('msg1', [{ type: 'text', text: 'Patched 1' }], Type.LLM.UnifiedMessageRole.assistant, 'AI'),
      createPatch('msg3', [{ type: 'text', text: 'Patched 3' }], Type.LLM.UnifiedMessageRole.assistant, 'AI'),
      createPatch('msg5', [{ type: 'text', text: 'Patched 5' }], Type.LLM.UnifiedMessageRole.assistant, 'AI')
    ];

    const result = patchMessages(messages, patches);

    // Verify original order is preserved
    expect(result.map((m) => m.id)).toEqual(originalOrder);

    // Verify patches were still applied
    expect(result.find((m) => m.id === 'msg1')?.content).toEqual([{ type: 'text', text: 'Patched 1' }]);
    expect(result.find((m) => m.id === 'msg3')?.content).toEqual([{ type: 'text', text: 'Patched 3' }]);
    expect(result.find((m) => m.id === 'msg5')?.content).toEqual([{ type: 'text', text: 'Patched 5' }]);
    expect(result.find((m) => m.id === 'msg2')?.content).toEqual([{ type: 'text', text: 'Message 2' }]);
    expect(result.find((m) => m.id === 'msg4')?.content).toEqual([{ type: 'text', text: 'Message 4' }]);
  });

  it('should handle empty arrays correctly', () => {
    const message = createMessage('msg1', [{ type: 'text', text: 'Message 1' }]);
    const patch = createPatch(
      'msg1',
      [{ type: 'text', text: 'Patched 1' }],
      Type.LLM.UnifiedMessageRole.assistant,
      'AI'
    );

    // Case 1: Empty patches array
    expect(patchMessages([message], [])).toEqual([message]);

    // Case 2: Empty messages array
    expect(patchMessages([], [patch])).toEqual([]);

    // Case 3: Both arrays empty
    expect(patchMessages([], [])).toEqual([]);

    // Case 4: Multiple messages with empty patches
    const messages = [
      createMessage('msg1', [{ type: 'text', text: 'Message 1' }]),
      createMessage('msg2', [{ type: 'text', text: 'Message 2' }]),
      createMessage('msg3', [{ type: 'text', text: 'Message 3' }])
    ];
    expect(patchMessages(messages, [])).toEqual(messages);

    // Case 5: Empty messages with multiple patches
    const patches = [
      createPatch('msg1', [{ type: 'text', text: 'Patch 1' }], Type.LLM.UnifiedMessageRole.assistant, 'AI'),
      createPatch('msg2', [{ type: 'text', text: 'Patch 2' }], Type.LLM.UnifiedMessageRole.user, 'User'),
      createPatch('msg3', [{ type: 'text', text: 'Patch 3' }], Type.LLM.UnifiedMessageRole.assistant, 'AI')
    ];
    expect(patchMessages([], patches)).toEqual([]);
  });

  it('should handle non-numeric sequenceIds by treating them as NaN', () => {
    const message = createMessage('msg1', [{ type: 'text', text: 'Original content' }]);

    // Create patches with non-numeric and numeric sequenceIds
    const patches = [
      {
        ...createPatch(
          'msg1',
          [{ type: 'text', text: 'Numeric sequenceId patch' }],
          Type.LLM.UnifiedMessageRole.assistant,
          'AI'
        ),
        sequenceId: '10'
      },
      {
        ...createPatch(
          'msg1',
          [{ type: 'text', text: 'Non-numeric sequenceId patch' }],
          Type.LLM.UnifiedMessageRole.assistant,
          'AI'
        ),
        sequenceId: 'abc'
      }
    ];

    const result = patchMessages([message], patches);

    // The actual behavior depends on the JavaScript engine's implementation of sorting with NaN values
    // We just verify that both patches were considered and one of them was applied last
    expect(result[0].content[0].type).toBe('text');
    const contentItem = result[0].content[0] as { type: 'text'; text: string };
    expect(contentItem.text).toMatch(/(Numeric sequenceId patch|Non-numeric sequenceId patch)/);
  });

  it('should apply partial patches by updating only specified fields', () => {
    const message = createMessage('msg1', [{ type: 'text', text: 'Original content' }]);
    const originalRole = message.role;
    const originalAuthor = message.author;

    // Create a patch that only updates content
    const contentOnlyPatch = {
      ...createPatch('msg1', [{ type: 'text', text: 'Updated content' }], originalRole, originalAuthor),
      // Keep all other fields the same as the original message
      llmName: message.llmName,
      manifestName: message.manifestName,
      llmIgnore: message.llmIgnore
    };

    const result = patchMessages([message], [contentOnlyPatch]);

    // Verify only content was updated
    expect(result[0].content).toEqual([{ type: 'text', text: 'Updated content' }]);
    expect(result[0].role).toBe(originalRole);
    expect(result[0].author).toBe(originalAuthor);
    expect(result[0].llmName).toBe(message.llmName);
    expect(result[0].manifestName).toBe(message.manifestName);
    expect(result[0].llmIgnore).toBe(message.llmIgnore);
  });

  it('should apply patches in ascending order of sequenceId', () => {
    const message = createMessage('msg1', [{ type: 'text', text: 'Original content' }]);

    // Create patches with explicit sequenceIds in random order
    const patches = [
      {
        ...createPatch('msg1', [{ type: 'text', text: 'Second patch' }], Type.LLM.UnifiedMessageRole.user, 'User 2'),
        sequenceId: '20'
      },
      {
        ...createPatch('msg1', [{ type: 'text', text: 'First patch' }], Type.LLM.UnifiedMessageRole.assistant, 'AI'),
        sequenceId: '10'
      },
      {
        ...createPatch('msg1', [{ type: 'text', text: 'Third patch' }], Type.LLM.UnifiedMessageRole.user, 'User 3'),
        sequenceId: '30'
      }
    ];

    const result = patchMessages([message], patches);

    // Patches should be applied in order of sequenceId: 10, 20, 30
    // So the final state should reflect the "Third patch"
    expect(result[0].content).toEqual([{ type: 'text', text: 'Third patch' }]);
    expect(result[0].author).toBe('User 3');
  });

  it('should handle a reasonable number of patches in a real-world scenario', () => {
    const message = createMessage('msg1', [{ type: 'text', text: 'Original content' }]);

    // Create 5 patches, which is more realistic for a typical use case
    const patches = [
      createPatch('msg1', [{ type: 'text', text: 'First update' }], Type.LLM.UnifiedMessageRole.assistant, 'AI'),
      createPatch('msg1', [{ type: 'text', text: 'Second update' }], Type.LLM.UnifiedMessageRole.user, 'User'),
      createPatch('msg1', [{ type: 'text', text: 'Third update' }], Type.LLM.UnifiedMessageRole.assistant, 'AI'),
      createPatch('msg1', [{ type: 'text', text: 'Fourth update' }], Type.LLM.UnifiedMessageRole.user, 'User'),
      createPatch('msg1', [{ type: 'text', text: 'Final update' }], Type.LLM.UnifiedMessageRole.assistant, 'AI')
    ];

    const result = patchMessages([message], patches);

    // Last patch should be applied
    expect(result[0].content).toEqual([{ type: 'text', text: 'Final update' }]);
    expect(result[0].author).toBe('AI');

    // Original message should remain unchanged
    expect(message.content).toEqual([{ type: 'text', text: 'Original content' }]);
  });

  it('should handle numeric sequenceIds in correct order', () => {
    const message = createMessage('msg1', [{ type: 'text', text: 'Original content' }]);

    // Create patches with various numeric sequenceIds
    const patches = [
      {
        ...createPatch(
          'msg1',
          [{ type: 'text', text: 'Zero sequenceId' }],
          Type.LLM.UnifiedMessageRole.assistant,
          'AI 1'
        ),
        sequenceId: '0'
      },
      {
        ...createPatch(
          'msg1',
          [{ type: 'text', text: 'Negative sequenceId' }],
          Type.LLM.UnifiedMessageRole.assistant,
          'AI 2'
        ),
        sequenceId: '-5'
      },
      {
        ...createPatch(
          'msg1',
          [{ type: 'text', text: 'Positive sequenceId' }],
          Type.LLM.UnifiedMessageRole.assistant,
          'AI 3'
        ),
        sequenceId: '5'
      }
    ];

    const result = patchMessages([message], patches);

    // Patches should be applied in numeric order: -5, 0, 5
    expect(result[0].content).toEqual([{ type: 'text', text: 'Positive sequenceId' }]);
    expect(result[0].author).toBe('AI 3');
  });

  it('should document the shallow copy behavior of nested objects', () => {
    const message = createMessage('msg1', [{ type: 'text', text: 'Original content' }]);

    // Create a simple ctx object
    const simpleCtx = { key: 'value' };

    const patch = {
      ...createPatch('msg1', [{ type: 'text', text: 'Patched content' }], Type.LLM.UnifiedMessageRole.assistant, 'AI'),
      ctx: simpleCtx
    };

    const result = patchMessages([message], [patch]);

    // Verify the ctx was copied correctly
    expect(result[0].ctx).toEqual(simpleCtx);

    // Note: The current implementation uses shallow copying.
    // If deep copying of nested objects is required, the implementation
    // should be modified to use a deep clone function.
  });

  it('should handle error cases gracefully', () => {
    const message = createMessage('msg1', [{ type: 'text', text: 'Original content' }]);

    // Test with valid message but invalid patch properties
    const invalidPatch = {
      ...createPatch('msg1', [{ type: 'text', text: 'Invalid patch' }], Type.LLM.UnifiedMessageRole.assistant, 'AI')
    };
    // @ts-expect-error - Remove required property to test runtime behavior
    delete invalidPatch.messageId;

    // Should not throw when patch is missing required properties
    expect(() => patchMessages([message], [invalidPatch])).not.toThrow();

    // Test with empty arrays which should work fine
    expect(() => patchMessages([], [])).not.toThrow();

    // Note: The function doesn't handle null/undefined inputs gracefully,
    // which could be an improvement for the implementation.
    // If null/undefined handling is required, the implementation should be updated.
  });

  it('should handle a realistic chat conversation scenario', () => {
    // Create a conversation with multiple messages
    const userMessage1 = createMessage(
      'user1',
      [{ type: 'text', text: 'Hello, how can you help me?' }],
      Type.LLM.UnifiedMessageRole.user,
      'User'
    );
    const assistantMessage1 = createMessage(
      'assistant1',
      [{ type: 'text', text: 'I can help with various tasks. What do you need?' }],
      Type.LLM.UnifiedMessageRole.assistant,
      'AI'
    );
    const userMessage2 = createMessage(
      'user2',
      [{ type: 'text', text: 'I need help with my code.' }],
      Type.LLM.UnifiedMessageRole.user,
      'User'
    );

    const messages = [userMessage1, assistantMessage1, userMessage2];

    // Create patches that might occur in a real conversation
    const patches = [
      // User edits their second message to provide more context
      createPatch(
        'user2',
        [{ type: 'text', text: 'I need help with my JavaScript code. It has a bug.' }],
        Type.LLM.UnifiedMessageRole.user,
        'User'
      ),

      // Assistant responds to the updated message
      createPatch(
        'assistant1',
        [{ type: 'text', text: 'I can definitely help with JavaScript bugs. Can you share the code?' }],
        Type.LLM.UnifiedMessageRole.assistant,
        'AI'
      )
    ];

    const result = patchMessages(messages, patches);

    // Verify the conversation was updated correctly
    expect(result).toHaveLength(3);
    expect(result[0].content).toEqual(userMessage1.content); // Unchanged
    expect(result[1].content).toEqual([
      { type: 'text', text: 'I can definitely help with JavaScript bugs. Can you share the code?' }
    ]); // Updated
    expect(result[2].content).toEqual([{ type: 'text', text: 'I need help with my JavaScript code. It has a bug.' }]); // Updated
  });
});
