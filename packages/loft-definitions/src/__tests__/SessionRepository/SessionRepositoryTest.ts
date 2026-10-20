import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Repository, SessionNotFoundError, Type } from '../..';

/**
 * Generates a test session data object for testing
 * @param externalKey Optional external key to use. If not provided, generates random values. Pass {} for empty external key.
 */
function createTestSession(externalKey?: Type.Entity.Session['externalKey']): Type.Entity.CreateSession {
  if (externalKey === undefined) {
    // Generate stable UUIDs for testing
    const userId = `user-${crypto.randomUUID()}`;
    const conversationId = `conv-${crypto.randomUUID()}`;

    externalKey = {
      userId,
      conversationId
    };
  }

  const isEmptyKey = Object.keys(externalKey).length === 0;

  return {
    ctx: { testCase: `test-session-${isEmptyKey ? 'empty-key-' : ''}${Date.now()}` },
    currentLlmName: 'test-llm',
    currentManifestName: 'test-manifest',
    externalKey
  };
}

/**
 * Reusable test suite for Session repository implementations.
 * This can be called from any Session repository implementation test file.
 *
 * @param repository Session repository instance to test
 */
export function testSessionRepository(repository: Repository.Session) {
  describe('SessionRepository Tests', () => {
    // Track the session created for cleanup
    let createdSession: Type.Entity.Session | undefined;

    // Base tests for any Session repository implementation
    describe('checkHealth method', () => {
      it('should return true with a healthy connection', async () => {
        const result = await repository.checkHealth();
        expect(result).toBe(true);
      });
    });

    describe('create method', () => {
      it('should create a new session', async () => {
        // Arrange
        const newSession = createTestSession();

        // Act
        createdSession = await repository.create(newSession);

        // Assert
        expect(createdSession).toBeDefined();
        if (createdSession) {
          expect(createdSession.id).toBeDefined();
          expect(createdSession.ctx).toEqual(newSession.ctx);
          expect(createdSession.currentLlmName).toEqual(newSession.currentLlmName);
          expect(createdSession.currentManifestName).toEqual(newSession.currentManifestName);
          expect(createdSession.externalKey).toEqual(newSession.externalKey);
          expect(createdSession.createdAt).toBeInstanceOf(Date);
          expect(createdSession.updatedAt).toBeInstanceOf(Date);
        }
      });

      it('should throw error when trying to create a session with existing externalKey', async () => {
        // Arrange
        const newSession = createTestSession();
        if (createdSession) {
          newSession.externalKey = createdSession.externalKey; // Use the same external key to cause conflict

          // Act & Assert
          await expect(repository.create(newSession)).rejects.toThrow();
        } else {
          // Skip if no created session available
          expect(true).toBe(true);
        }
      });

      it('should throw error when trying to create a session with existing externalKey even with different other fields', async () => {
        // Arrange
        if (!createdSession) {
          // Skip if no created session available
          expect(true).toBe(true);
          return;
        }

        const newSession = createTestSession();
        // Use the same external key but different other fields
        newSession.externalKey = createdSession.externalKey;
        newSession.currentLlmName = 'different-llm';
        newSession.currentManifestName = 'different-manifest';
        newSession.ctx = { differentContext: true };

        // Act & Assert
        await expect(repository.create(newSession)).rejects.toThrow();
      });

      it('should create multiple sessions with empty externalKey without errors', async () => {
        // Array to track created sessions for cleanup
        const emptyKeySessionIds: string[] = [];

        try {
          // Create 3 sessions with empty externalKey objects
          for (let i = 0; i < 3; i++) {
            const newSession = createTestSession({});

            // Each session has slightly different context for identification
            newSession.ctx = {
              ...newSession.ctx,
              index: i
            };

            // Create session with empty externalKey
            const session = await repository.create(newSession);

            // Verify session was created
            expect(session).toBeDefined();
            expect(session.id).toBeDefined();
            expect(session.externalKey).toEqual({});

            // Track for cleanup
            emptyKeySessionIds.push(session.id);
          }

          // Verify we created all 3 sessions
          expect(emptyKeySessionIds.length).toBe(3);
        } finally {
          // Clean up all created sessions
          for (const id of emptyKeySessionIds) {
            try {
              await repository.deleteById(id);
            } catch (e) {
              // Ignore cleanup errors
            }
          }
        }
      });
    });

    describe('getById method', () => {
      it('should retrieve a session by ID', async () => {
        // Skip if no session was created
        if (!createdSession) {
          // Skip if no created session available
          expect(true).toBe(true);
          return;
        }

        // Act
        const retrievedSession = await repository.getById(createdSession.id);

        // Assert
        expect(retrievedSession).toBeDefined();
        expect(retrievedSession.id).toEqual(createdSession.id);
        expect(retrievedSession.ctx).toEqual(createdSession.ctx);
        expect(retrievedSession.currentLlmName).toEqual(createdSession.currentLlmName);
        expect(retrievedSession.currentManifestName).toEqual(createdSession.currentManifestName);
        expect(retrievedSession.externalKey).toEqual(createdSession.externalKey);
      });

      it('should throw an error when trying to get a non-existent session', async () => {
        // Arrange
        const nonExistentId = '00000000-0000-0000-0000-000000000000';

        // Act & Assert
        await expect(repository.getById(nonExistentId)).rejects.toBeInstanceOf(SessionNotFoundError);
      });
    });

    describe('getByExternalKey method', () => {
      it('should retrieve a session by external key', async () => {
        // Skip if no session was created
        if (!createdSession) {
          // Skip if no created session available
          expect(true).toBe(true);
          return;
        }

        // Act
        const retrievedSession = await repository.getByExternalKey(createdSession.externalKey);

        // Assert
        expect(retrievedSession).toBeDefined();
        expect(retrievedSession.id).toEqual(createdSession.id);
        expect(retrievedSession.ctx).toEqual(createdSession.ctx);
        expect(retrievedSession.externalKey).toEqual(createdSession.externalKey);
      });

      it('should throw an error when trying to get a session with non-existent external key', async () => {
        // Arrange
        const nonExistentKey = {
          userId: 'non-existent-user',
          conversationId: 'non-existent-conversation'
        };

        // Act & Assert
        await expect(repository.getByExternalKey(nonExistentKey)).rejects.toBeInstanceOf(SessionNotFoundError);
      });

      it('should throw an error when trying to get a session with empty external key', async () => {
        // Arrange
        const emptyKey = {};

        // Act & Assert
        await expect(repository.getByExternalKey(emptyKey)).rejects.toThrow(
          'getByExternalKey() External key cannot be an empty object'
        );
      });
    });

    describe('updateById method', () => {
      it('should update a session by ID', async () => {
        // Skip if no session was created
        if (!createdSession) {
          // Skip if no created session available
          expect(true).toBe(true);
          return;
        }

        // Arrange
        const updatePayload = {
          currentLlmName: 'updated-llm',
          currentManifestName: 'updated-manifest',
          ctx: { ...createdSession.ctx, updated: true }
        };

        // Act
        const updatedSession = await repository.updateById(createdSession.id, updatePayload);

        // Assert
        expect(updatedSession).toBeDefined();
        expect(updatedSession.id).toEqual(createdSession.id);
        expect(updatedSession.currentLlmName).toEqual(updatePayload.currentLlmName);
        expect(updatedSession.currentManifestName).toEqual(updatePayload.currentManifestName);
        expect(updatedSession.ctx).toEqual(updatePayload.ctx);
        expect(updatedSession.externalKey).toEqual(createdSession.externalKey);

        // Update our reference for future tests
        createdSession = updatedSession;
      });

      it('should throw an error when trying to update a non-existent session', async () => {
        // Arrange
        const nonExistentId = '00000000-0000-0000-0000-000000000000';
        const updatePayload = { currentLlmName: 'updated-llm' };

        // Act & Assert
        await expect(repository.updateById(nonExistentId, updatePayload)).rejects.toBeInstanceOf(SessionNotFoundError);
      });
    });

    describe('deleteById method', () => {
      it('should delete a session by ID', async () => {
        // Create a new session to delete
        const sessionToDelete = await repository.create(createTestSession());

        // Act
        await repository.deleteById(sessionToDelete.id);

        // Assert - try to get deleted session
        await expect(repository.getById(sessionToDelete.id)).rejects.toThrow();
      });

      it('should throw an error when trying to delete a non-existent session', async () => {
        // Arrange
        const nonExistentId = '00000000-0000-0000-0000-000000000000';

        // Act & Assert
        await expect(repository.deleteById(nonExistentId)).rejects.toBeInstanceOf(SessionNotFoundError);
      });
    });

    // Additional tests for externalKey uniqueness
    describe('externalKey uniqueness', () => {
      let testSession1: Type.Entity.Session;
      let testSession2: Type.Entity.Session;

      // Setup - create two sessions with different externalKeys
      beforeEach(async () => {
        // Create first session
        testSession1 = await repository.create(createTestSession());
        // Create second session with different externalKey
        testSession2 = await repository.create(createTestSession());
      });

      // Cleanup - delete test sessions
      afterEach(async () => {
        try {
          if (testSession1?.id) await repository.deleteById(testSession1.id);
        } catch (e) {
          // Ignore deletion errors during cleanup
        }
        try {
          if (testSession2?.id) await repository.deleteById(testSession2.id);
        } catch (e) {
          // Ignore deletion errors during cleanup
        }
      });

      it('should ignore externalKey in update payload', async () => {
        // Arrange
        const originalExternalKey = testSession1.externalKey;
        const newExternalKey = {
          userId: 'attempted-update-user',
          conversationId: 'attempted-update-conversation'
        };

        const updatePayload = {
          currentLlmName: 'updated-llm-name',
          externalKey: newExternalKey
        };

        // Act
        const updatedSession = await repository.updateById(testSession1.id, updatePayload);

        // Assert - externalKey should remain unchanged, other fields should update
        expect(updatedSession).toBeDefined();
        expect(updatedSession.currentLlmName).toEqual(updatePayload.currentLlmName);
        expect(updatedSession.externalKey).toEqual(originalExternalKey);
        expect(updatedSession.externalKey).not.toEqual(newExternalKey);
      });

      it('should allow creating a new session with previously used externalKey after deletion', async () => {
        // Arrange - save the externalKey, then delete the session
        const savedExternalKey = testSession1.externalKey;
        await repository.deleteById(testSession1.id);

        // Act - create a new session with the same externalKey
        const recreatedSession = await repository.create({
          ...createTestSession(),
          externalKey: savedExternalKey
        });

        // Assert
        expect(recreatedSession).toBeDefined();
        expect(recreatedSession.externalKey).toEqual(savedExternalKey);

        // Clean up the recreated session
        try {
          await repository.deleteById(recreatedSession.id);
        } catch (e) {
          // Ignore cleanup errors
        }
      });

      it('should ensure externalKey is case-sensitive for uniqueness', async () => {
        // This test is only relevant if externalKey contains string values

        // Arrange - create a session with a specific externalKey
        const customKey = {
          userId: 'CaseSensitiveUser',
          conversationId: 'CaseSensitiveConversation'
        };

        const customSession = await repository.create({
          ...createTestSession(),
          externalKey: customKey
        });

        // Try to create another session with the same externalKey but different case
        const lowerCaseKey = {
          userId: customKey.userId.toLowerCase(),
          conversationId: customKey.conversationId.toLowerCase()
        };

        // Act - should be treated as different due to case sensitivity
        const differentCaseSession = await repository.create({
          ...createTestSession(),
          externalKey: lowerCaseKey
        });

        // Assert - should be able to create with different case
        expect(differentCaseSession).toBeDefined();
        expect(differentCaseSession.id).not.toEqual(customSession.id);

        // Clean up
        try {
          await repository.deleteById(customSession.id);
          await repository.deleteById(differentCaseSession.id);
        } catch (e) {
          // Ignore cleanup errors
        }
      });

      it('should ensure externalKey uniqueness is based on the entire object, not just parts', async () => {
        // Arrange - create a session with a specific externalKey
        const specificKey = {
          userId: 'sameUser',
          conversationId: 'conversation1'
        };

        const specificSession = await repository.create({
          ...createTestSession(),
          externalKey: specificKey
        });

        // Try to create another session with partially same externalKey
        const partiallyDifferentKey = {
          userId: 'sameUser',
          conversationId: 'conversation2' // Different conversation
        };

        // Act - should be able to create with partially different externalKey
        const partialMatchSession = await repository.create({
          ...createTestSession(),
          externalKey: partiallyDifferentKey
        });

        // Assert
        expect(partialMatchSession).toBeDefined();
        expect(partialMatchSession.id).not.toEqual(specificSession.id);

        // Clean up
        try {
          await repository.deleteById(specificSession.id);
          await repository.deleteById(partialMatchSession.id);
        } catch (e) {
          // Ignore cleanup errors
        }
      });
    });

    // Final cleanup
    afterAll(async () => {
      if (createdSession?.id) {
        try {
          await repository.deleteById(createdSession.id);
        } catch (error) {
          console.warn(`Failed to cleanup session ${createdSession.id}:`, error);
        }
      }
    });
  });
}
