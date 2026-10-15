import { Repository, Type } from '@moc-global/loft-definitions';
import { configureSpyLoggerStrategy } from '@moc-global/loft-test-suite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Session } from '../../../entities/Session';

describe('Session', () => {
  // Common test fixtures
  const mockSessionId = 'test-session-id';

  const spyLoggerStrategy = configureSpyLoggerStrategy();

  // Mock session repository with proper typing
  const mockSessionRepository: Repository.Session = {
    create: vi.fn().mockReturnValue(Promise.resolve({})),
    getById: vi.fn().mockReturnValue(Promise.resolve({})),
    getByExternalKey: vi.fn().mockReturnValue(Promise.resolve({})),
    updateById: vi.fn().mockReturnValue(Promise.resolve({})),
    deleteById: vi.fn().mockReturnValue(Promise.resolve()),
    checkHealth: vi.fn().mockReturnValue(Promise.resolve(true)),
    end: vi.fn().mockReturnValue(Promise.resolve())
  };

  // Helper function to create mock session data
  const createMockSessionData = (overrides: Partial<Type.Entity.Session> = {}): Type.Entity.Session => ({
    id: mockSessionId,
    ctx: {},
    currentLlmName: 'test-llm-name',
    currentManifestName: 'test-manifest-name',
    externalKey: { userId: 'test-user' },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  });

  let session: Session;
  let mockSessionData: Type.Entity.Session;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    mockSessionData = createMockSessionData();
    session = new Session(mockSessionRepository, mockSessionData);
  });

  describe('ctx setter', () => {
    it('should merge new context with existing context', () => {
      // Arrange
      const initialCtx = { key1: 'value1' };
      const newCtx = { key2: 'value2' };

      // Create session with initial context
      mockSessionData = createMockSessionData({ ctx: initialCtx });
      session = new Session(mockSessionRepository, mockSessionData);

      // Act
      session.ctx = newCtx as any;

      // Assert
      expect(session.ctx).toEqual({ key1: 'value1', key2: 'value2' });
    });

    it('should override existing context keys with new values', () => {
      // Arrange
      const initialCtx = { key1: 'value1', key2: 'initial-value2' };
      const newCtx = { key2: 'updated-value2' };

      // Create session with initial context
      mockSessionData = createMockSessionData({ ctx: initialCtx });
      session = new Session(mockSessionRepository, mockSessionData);

      // Act
      session.ctx = newCtx as any;

      // Assert
      expect(session.ctx).toEqual({ key1: 'value1', key2: 'updated-value2' });
    });
  });

  describe('prepareUpdatePayload', () => {
    it('should return current session data when no update data is provided', () => {
      // Arrange
      const currentLlmName = 'current-llm';
      const currentManifestName = 'current-manifest';
      const currentCtx = { key1: 'value1' };

      mockSessionData = createMockSessionData({
        currentLlmName,
        currentManifestName,
        ctx: currentCtx
      });
      session = new Session(mockSessionRepository, mockSessionData);

      // Act
      // @ts-expect-error - accessing private method for testing
      const result = session.prepareUpdatePayload();

      // Assert
      expect(result).toEqual({
        currentLlmName,
        currentManifestName,
        ctx: currentCtx
      });
    });

    it('should merge provided session data with current session data', () => {
      // Arrange
      const currentLlmName = 'current-llm';
      const currentManifestName = 'current-manifest';
      const currentCtx = { key1: 'value1' };

      mockSessionData = createMockSessionData({
        currentLlmName,
        currentManifestName,
        ctx: currentCtx
      });
      session = new Session(mockSessionRepository, mockSessionData);

      const updateData = {
        currentLlmName: 'new-llm',
        ctx: { key2: 'value2' }
      };

      // Act
      // @ts-expect-error - accessing private method for testing
      const result = session.prepareUpdatePayload(updateData as any);

      // Assert
      expect(result).toEqual({
        currentLlmName: 'new-llm',
        currentManifestName,
        ctx: { key2: 'value2' }
      });
    });
  });

  describe('selfOverwrite', () => {
    it('should update session properties from provided session data', () => {
      // Arrange
      const initialLlmName = 'initial-llm';
      const initialManifestName = 'initial-manifest';
      const initialCtx = { key1: 'value1' };

      mockSessionData = createMockSessionData({
        currentLlmName: initialLlmName,
        currentManifestName: initialManifestName,
        ctx: initialCtx
      });
      session = new Session(mockSessionRepository, mockSessionData);

      const newSessionData = createMockSessionData({
        currentLlmName: 'new-llm',
        currentManifestName: 'new-manifest',
        ctx: { key2: 'value2' }
      });

      // Act
      // @ts-expect-error - accessing private method for testing
      session.selfOverwrite(newSessionData);

      // Assert
      expect(session.currentLlmName).toBe('new-llm');
      expect(session.currentManifestName).toBe('new-manifest');
      expect(session.ctx).toEqual({ key2: 'value2' });
    });
  });

  describe('update', () => {
    it('should call repository.updateById with prepared payload', async () => {
      // Arrange
      const updateData = {
        currentLlmName: 'new-llm',
        ctx: { key: 'value' }
      };

      const updatedSessionData = createMockSessionData({
        currentLlmName: 'new-llm',
        ctx: { key: 'value' }
      });

      mockSessionRepository.updateById = vi.fn().mockResolvedValue(updatedSessionData);

      // Act
      await session.update(updateData as any);

      // Assert
      expect(mockSessionRepository.updateById).toHaveBeenCalledWith(
        mockSessionId,
        expect.objectContaining({
          currentLlmName: 'new-llm',
          currentManifestName: 'test-manifest-name',
          ctx: expect.any(Object)
        })
      );
      expect(spyLoggerStrategy.trace).toHaveBeenCalledWith('Updating session', 'Session', { sessionId: mockSessionId });
    });

    it('should update session properties after successful repository update', async () => {
      // Arrange
      const updatedSessionData = createMockSessionData({
        currentLlmName: 'updated-llm',
        currentManifestName: 'updated-manifest',
        ctx: { updated: true }
      });

      mockSessionRepository.updateById = vi.fn().mockResolvedValue(updatedSessionData);

      // Act
      await session.update();

      // Assert
      expect(session.currentLlmName).toBe('updated-llm');
      expect(session.currentManifestName).toBe('updated-manifest');
      expect(session.ctx).toEqual({ updated: true });
    });

    it('should log error and rethrow when repository update fails', async () => {
      // Arrange
      const error = new Error('Update failed');
      mockSessionRepository.updateById = vi.fn().mockRejectedValue(error);

      // Act & Assert
      await expect(session.update()).rejects.toThrow('Update failed');
      expect(spyLoggerStrategy.error).toHaveBeenCalledWith('Error updating session', 'Session', error, {
        sessionId: mockSessionId
      });
    });
  });
});
