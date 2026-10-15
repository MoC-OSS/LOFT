import { Interface, Repository, Schema } from '@moc-global/loft-definitions';
import { configureSpyLoggerStrategy } from '@moc-global/loft-test-suite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodObject } from 'zod';

import { ManifestManager } from '../../../../managers/ManifestManager';

// Mock the utils functions
vi.mock('../../../../base-components/utils', () => ({
  createNewPathWithSortableFileName: vi.fn((path) => `${path}/error-123.json`),
  isJSON: vi.fn(() => false)
}));

const spyLoggerStrategy = configureSpyLoggerStrategy();

describe('ManifestManager - Edge Cases', () => {
  let manifestManager: ManifestManager;
  let mockManifestRepository: Repository.ObjectStorage;
  let mockManifestManagerConfig: Interface.ManifestManagerConfig;
  let mockSchema: ZodObject<any>;

  const mockManifestData = {
    llmManifests: {
      'test-bot': {
        openai: {
          systemMessage: 'you are a helpful assistant',
          modelPreset: {
            model: 'gpt-4',
            temperature: 0.7
          }
        },
        anthropic: {
          systemMessage: 'you are a helpful assistant from Anthropic',
          modelPreset: {
            model: 'claude-3',
            temperature: 0.5
          }
        }
      }
    },
    prompts: {},
    aiTasks: {}
  };

  beforeEach(() => {
    mockManifestRepository = {
      get: vi.fn(() => Promise.resolve(mockManifestData)),
      upload: vi.fn(() => Promise.resolve())
    } as unknown as Repository.ObjectStorage;

    mockManifestManagerConfig = {
      manifestPath: 'path/to/manifest.json',
      errorPath: 'path/to/errors',
      cacheExpirationTime: 60000 // 1 minute
    };

    // Create a mock schema for validation
    mockSchema = {
      parse: vi.fn((data) => data)
    } as unknown as ZodObject<any>;

    // Mock the LoftManifest schema
    vi.spyOn(Schema.LoftManifest, 'parse').mockImplementation((data) => data as any);

    manifestManager = new ManifestManager(mockManifestRepository, mockManifestManagerConfig);
  });

  describe('A. Concurrent Registration Tests', () => {
    it('registers both schemas when they are registered concurrently', async () => {
      const slowSchema = {
        parse: vi.fn((data) => data)
      } as unknown as ZodObject<any>;
      const fastSchema = {
        parse: vi.fn((data) => data)
      } as unknown as ZodObject<any>;

      // Fire both concurrently — must not throw
      await expect(
        Promise.all([
          manifestManager.useLlmManifestSchema('llm-slow', slowSchema),
          manifestManager.useLlmManifestSchema('llm-fast', fastSchema)
        ])
      ).resolves.toBeDefined();

      // Both schemas must be registered
      // @ts-expect-error - accessing private property for testing
      expect(manifestManager.llmManifestSchemas.has('llm-slow')).toBe(true);
      // @ts-expect-error - accessing private property for testing
      expect(manifestManager.llmManifestSchemas.has('llm-fast')).toBe(true);
    });

    it('should keep queue alive after a registration error so subsequent calls succeed', async () => {
      const errorSchema = {
        parse: vi.fn().mockImplementation(() => {
          throw new Error('Validation error');
        })
      } as unknown as ZodObject<any>;

      // Set up cached manifest to trigger schema validation inside doRegisterSchema
      // @ts-expect-error - accessing private property for testing
      manifestManager.cachedManifest = {
        llmManifests: {
          'test-bot': {
            'error-llm': {
              systemMessage: 'test',
              modelPreset: { invalid: 'data' }
            }
          }
        }
      };

      // First call should reject
      await expect(manifestManager.useLlmManifestSchema('error-llm', errorSchema)).rejects.toThrow();

      // Second call (different schema) should still succeed despite previous error
      await expect(manifestManager.useLlmManifestSchema('healthy-llm', mockSchema)).resolves.toBeUndefined();
      // @ts-expect-error - accessing private property for testing
      expect(manifestManager.llmManifestSchemas.has('healthy-llm')).toBe(true);
    });

    it('should allow sequential registration after previous one completes', async () => {
      await manifestManager.useLlmManifestSchema('llm-1', mockSchema);
      await expect(manifestManager.useLlmManifestSchema('llm-2', mockSchema)).resolves.toBeUndefined();

      // @ts-expect-error - accessing private property for testing
      expect(manifestManager.llmManifestSchemas.has('llm-1')).toBe(true);
      // @ts-expect-error - accessing private property for testing
      expect(manifestManager.llmManifestSchemas.has('llm-2')).toBe(true);
    });
  });

  describe('B. Recovery Mechanism Tests', () => {
    it('should extend cache expiration by 5 minutes on update failure', async () => {
      const error = new Error('Network error');
      mockManifestRepository.get = vi.fn().mockRejectedValue(error);

      // Set initial expiration time
      const initialTime = new Date().getTime();
      // @ts-expect-error - accessing private property for testing
      manifestManager.expiredAt = initialTime;

      // Try to update cache (will fail)
      await manifestManager.updateCache();

      // Check that expiration was extended by 5 minutes
      // @ts-expect-error - accessing private property for testing
      const newExpiredAt = manifestManager.expiredAt;
      const expectedTime = initialTime + 5 * 60000; // 5 minutes

      // Allow for small timing differences
      expect(newExpiredAt).toBeGreaterThanOrEqual(expectedTime - 100);
      expect(newExpiredAt).toBeLessThanOrEqual(expectedTime + 1000);
      expect(spyLoggerStrategy.warn).toHaveBeenCalledWith(
        'For resilience, extending expired cache lifetime by 5 minute and will retry update',
        'ManifestManager'
      );
    });

    it('should keep existing cache when update fails', async () => {
      const existingCache = {
        llmManifests: { existing: { data: 'preserved' } }
      };

      // @ts-expect-error - accessing private property for testing
      manifestManager.cachedManifest = existingCache;

      const error = new Error('Update failed');
      mockManifestRepository.get = vi.fn().mockRejectedValue(error);

      await manifestManager.updateCache();

      // @ts-expect-error - accessing private property for testing
      expect(manifestManager.cachedManifest).toBe(existingCache);
      expect(spyLoggerStrategy.error).toHaveBeenCalledWith('Cache update failed:', 'ManifestManager', error);
    });

    it('should clear currentUpdatePromise after error', async () => {
      const error = new Error('Update failed');
      mockManifestRepository.get = vi.fn().mockRejectedValue(error);

      await manifestManager.updateCache();

      // @ts-expect-error - accessing private property for testing
      expect(manifestManager.currentUpdatePromise).toBeUndefined();
    });

    it('should allow retry after failed update', async () => {
      const error = new Error('First attempt failed');
      mockManifestRepository.get = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(mockManifestData);

      // First attempt fails
      await manifestManager.updateCache();
      expect(spyLoggerStrategy.error).toHaveBeenCalledWith('Cache update failed:', 'ManifestManager', error);

      // Second attempt should work
      await manifestManager.updateCache();
      // @ts-expect-error - accessing private property for testing
      expect(manifestManager.cachedManifest).toEqual(mockManifestData);
    });
  });

  describe('C. LLM Without Manifest Tests', () => {
    it('should register LLM even if not in manifest', async () => {
      // @ts-expect-error - accessing private property for testing
      manifestManager.cachedManifest = {
        llmManifests: {
          'test-bot': {
            // No 'new-llm' here
            'existing-llm': {
              systemMessage: 'test',
              modelPreset: {}
            }
          }
        }
      };

      await manifestManager.useLlmManifestSchema('new-llm', mockSchema);

      // @ts-expect-error - accessing private property for testing
      const registeredSchema = manifestManager.llmManifestSchemas.get('new-llm');
      expect(registeredSchema).toBe(mockSchema);
      expect(spyLoggerStrategy.warn).toHaveBeenCalledWith(
        'LLM strategy "new-llm" registered but not found in any manifest - will validate when manifest is updated',
        'ManifestManager'
      );
    });

    it('should warn when LLM not found in any manifest', async () => {
      // @ts-expect-error - accessing private property for testing
      manifestManager.cachedManifest = {
        llmManifests: {
          'bot-1': {},
          'bot-2': {}
        }
      };

      await manifestManager.useLlmManifestSchema('missing-llm', mockSchema);

      expect(spyLoggerStrategy.warn).toHaveBeenCalledWith(
        'LLM strategy "missing-llm" registered but not found in any manifest - will validate when manifest is updated',
        'ManifestManager'
      );
    });

    it('should validate LLM data when added to manifest later', async () => {
      // Create a fresh schema for this test
      const futureSchema = {
        parse: vi.fn((data) => data)
      } as unknown as ZodObject<any>;

      // Register schema first
      await manifestManager.useLlmManifestSchema('future-llm', futureSchema);

      // Later, manifest is updated with this LLM
      const updatedManifest = {
        llmManifests: {
          'test-bot': {
            'future-llm': {
              systemMessage: 'future system',
              modelPreset: {
                model: 'future-model',
                temperature: 0.8
              }
            }
          }
        }
      };

      const validated = manifestManager.validateManifests(updatedManifest.llmManifests);

      expect(validated['test-bot']['future-llm']).toBeDefined();
      expect(futureSchema.parse).toHaveBeenCalledWith({
        model: 'future-model',
        temperature: 0.8
      });
    });

    it('should handle LLM in manifest but no schema registered', () => {
      const manifestWithUnregisteredLLM = {
        'test-bot': {
          'unregistered-llm': {
            systemMessage: 'test',
            modelPreset: { model: 'test' }
          }
        }
      };

      const validated = manifestManager.validateManifests(manifestWithUnregisteredLLM);

      expect(spyLoggerStrategy.debug).toHaveBeenCalledWith(
        'Manifest entry for LLM "unregistered-llm" in "test-bot" will be validated when its strategy registers',
        'ManifestManager'
      );
      expect(spyLoggerStrategy.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('"unregistered-llm"'),
        'ManifestManager'
      );
      // Data should be kept as-is
      expect(validated['test-bot']['unregistered-llm']).toEqual({
        systemMessage: 'test',
        modelPreset: { model: 'test' }
      });
    });
  });

  describe('D. Validation Edge Cases', () => {
    it('should skip validation for unregistered LLM schemas', () => {
      const manifestObject = {
        'test-bot': {
          'no-schema-llm': {
            systemMessage: 'test',
            modelPreset: { anything: 'goes' }
          }
        }
      };

      const result = manifestManager.validateManifests(manifestObject);

      expect(result['test-bot']['no-schema-llm']).toEqual({
        systemMessage: 'test',
        modelPreset: { anything: 'goes' }
      });
      expect(spyLoggerStrategy.debug).toHaveBeenCalledWith(
        'Manifest entry for LLM "no-schema-llm" in "test-bot" will be validated when its strategy registers',
        'ManifestManager'
      );
      expect(spyLoggerStrategy.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('"no-schema-llm"'),
        'ManifestManager'
      );
    });

    it('should throw fatal error for invalid manifest data', async () => {
      const strictSchema = {
        parse: vi.fn(() => {
          throw new Error('temperature must be between 0 and 1');
        })
      } as unknown as ZodObject<any>;

      // @ts-expect-error - accessing private property for testing
      manifestManager.cachedManifest = {
        llmManifests: {
          'test-bot': {
            'strict-llm': {
              systemMessage: 'test',
              modelPreset: {
                model: 'gpt-4',
                temperature: 2.0 // Invalid: > 1
              }
            }
          }
        }
      };

      await expect(manifestManager.useLlmManifestSchema('strict-llm', strictSchema)).rejects.toThrow(
        'Invalid manifest data for LLM "strict-llm" in manifest "test-bot"'
      );

      expect(spyLoggerStrategy.fatal).toHaveBeenCalled();
    });

    it('should handle completely empty manifest file', () => {
      const emptyManifest = {};

      const result = manifestManager.validateManifests(emptyManifest);

      expect(result).toEqual({});
    });

    it('should handle manifest with empty LLM lists', async () => {
      const manifestWithEmptyLists = {
        'empty-bot': {}
      };

      // Register a schema
      await manifestManager.useLlmManifestSchema('some-llm', mockSchema);

      const result = manifestManager.validateManifests(manifestWithEmptyLists);

      expect(result).toEqual({ 'empty-bot': {} });
      expect(spyLoggerStrategy.warn).toHaveBeenCalledWith(
        'Manifest file is missing manifest for registered LLM strategy',
        'ManifestManager',
        {
          llmName: 'some-llm',
          manifestName: 'empty-bot'
        }
      );
    });

    it('should validate after schema registration', async () => {
      // First add manifest without schema
      const manifest = {
        'test-bot': {
          'late-llm': {
            systemMessage: 'test',
            modelPreset: { model: 'test', temperature: 0.5 }
          }
        }
      };

      const result = manifestManager.validateManifests(manifest);
      expect(result['test-bot']['late-llm'].modelPreset).toEqual({ model: 'test', temperature: 0.5 });

      // Now register schema with a fresh mock
      const lateLlmSchema = {
        parse: vi.fn((data) => data)
      } as unknown as ZodObject<any>;

      // @ts-expect-error - accessing private property for testing
      manifestManager.cachedManifest = { llmManifests: manifest };
      await manifestManager.useLlmManifestSchema('late-llm', lateLlmSchema);

      // Should have been validated
      expect(lateLlmSchema.parse).toHaveBeenCalledWith({ model: 'test', temperature: 0.5 });
    });
  });

  describe('E. Error Recovery Tests', () => {
    it('should recover from network errors', async () => {
      const networkError = new Error('ECONNREFUSED');
      mockManifestRepository.get = vi.fn().mockRejectedValueOnce(networkError).mockResolvedValueOnce(mockManifestData);

      // First call fails
      await manifestManager.updateCache();
      expect(spyLoggerStrategy.error).toHaveBeenCalledWith('Cache update failed:', 'ManifestManager', networkError);

      // Second call succeeds
      await manifestManager.updateCache();
      // @ts-expect-error - accessing private property for testing
      expect(manifestManager.cachedManifest).toEqual(mockManifestData);
    });

    it('should handle invalid JSON gracefully', async () => {
      const invalidJsonError = new Error('Unexpected token < in JSON at position 0');
      mockManifestRepository.get = vi.fn().mockRejectedValue(invalidJsonError);

      await manifestManager.updateCache();

      expect(spyLoggerStrategy.error).toHaveBeenCalledWith('Cache update failed:', 'ManifestManager', invalidJsonError);
      // @ts-expect-error - accessing private property for testing
      expect(manifestManager.currentUpdatePromise).toBeUndefined();
    });

    it('should handle missing manifest file', async () => {
      const notFoundError = new Error('404: File not found');
      mockManifestRepository.get = vi.fn().mockRejectedValue(notFoundError);

      await manifestManager.updateCache();

      expect(spyLoggerStrategy.error).toHaveBeenCalledWith('Cache update failed:', 'ManifestManager', notFoundError);
      expect(spyLoggerStrategy.warn).toHaveBeenCalledWith(
        'For resilience, extending expired cache lifetime by 5 minute and will retry update',
        'ManifestManager'
      );
    });

    it('should use stale cache when update fails', async () => {
      const staleCache = {
        llmManifests: {
          'old-bot': {
            'old-llm': {
              systemMessage: 'old but gold',
              modelPreset: {}
            }
          }
        }
      };

      // @ts-expect-error - accessing private property for testing
      manifestManager.cachedManifest = staleCache;
      // @ts-expect-error - accessing private property for testing
      manifestManager.expiredAt = new Date().getTime() - 1000; // Expired

      const error = new Error('Cannot update');
      mockManifestRepository.get = vi.fn().mockRejectedValue(error);

      // Try to get manifest (should trigger update that fails)
      // @ts-expect-error - accessing private method for testing
      await manifestManager.getManifest();

      // Should still have stale cache
      // @ts-expect-error - accessing private property for testing
      expect(manifestManager.cachedManifest).toBe(staleCache);
    });
  });

  describe('F. Error Messages Tests', () => {
    it('should show "No agent manifest found with declared LLM usage for: X"', async () => {
      // @ts-expect-error - accessing private property for testing
      manifestManager.cachedManifest = {
        llmManifests: {
          'test-bot': {
            'existing-llm': {
              systemMessage: 'test',
              modelPreset: {}
            }
          }
        }
      };

      await expect(manifestManager.getLlmManifest('test-bot', 'non-existent-llm')).rejects.toThrow(
        'No agent manifest found with declared LLM usage for: non-existent-llm'
      );
    });

    it('logs at debug, not warn, that an entry waits for its strategy to register', () => {
      const manifestWithNoSchema = {
        'test-bot': {
          'no-schema-llm': {
            systemMessage: 'test',
            modelPreset: {}
          }
        }
      };

      manifestManager.validateManifests(manifestWithNoSchema);

      expect(spyLoggerStrategy.debug).toHaveBeenCalledWith(
        'Manifest entry for LLM "no-schema-llm" in "test-bot" will be validated when its strategy registers',
        'ManifestManager'
      );
      expect(spyLoggerStrategy.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('"no-schema-llm"'),
        'ManifestManager'
      );
    });

    it('should log "For resilience, extending expired cache lifetime"', async () => {
      const error = new Error('Update failed');
      mockManifestRepository.get = vi.fn().mockRejectedValue(error);

      await manifestManager.updateCache();

      expect(spyLoggerStrategy.warn).toHaveBeenCalledWith(
        'For resilience, extending expired cache lifetime by 5 minute and will retry update',
        'ManifestManager'
      );
    });
  });

  describe('Additional Edge Cases', () => {
    it('should handle concurrent updateCache calls correctly', async () => {
      let callCount = 0;
      mockManifestRepository.get = vi.fn().mockImplementation(() => {
        callCount++;
        return new Promise((resolve) => {
          setTimeout(() => resolve(mockManifestData), 100);
        });
      });

      // Call updateCache multiple times concurrently
      const promises = [manifestManager.updateCache(), manifestManager.updateCache(), manifestManager.updateCache()];

      await Promise.all(promises);

      // Should only call repository once due to deduplication
      expect(callCount).toBe(1);
    });

    it('should handle missing systemMessage correctly', async () => {
      const manifestWithoutSystemMessage = {
        llmManifests: {
          'test-bot': {
            'no-system-llm': {
              // Missing systemMessage
              modelPreset: { model: 'test' }
            }
          }
        }
      };

      // @ts-expect-error - accessing private property for testing
      manifestManager.cachedManifest = manifestWithoutSystemMessage;

      await expect(manifestManager.getLlmManifest('test-bot', 'no-system-llm')).rejects.toThrow(
        'System Message not found'
      );
    });

    it('should handle initialization errors gracefully', async () => {
      const initError = new Error('Init failed');
      mockManifestRepository.get = vi.fn().mockRejectedValue(initError);

      // Create new instance that will fail during init
      const failingManager = new ManifestManager(mockManifestRepository, mockManifestManagerConfig);

      // Should not throw, but log error
      // @ts-expect-error - accessing private property for testing
      expect(failingManager.currentUpdatePromise).toBeDefined();

      // Wait for init to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - accessing private property for testing
      expect(failingManager.currentUpdatePromise).toBeUndefined();
    });
  });
});
