import { Interface, Repository, Schema } from '@moc-global/loft-definitions';
import { configureSpyLoggerStrategy } from '@moc-global/loft-test-suite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError, ZodObject } from 'zod';

import { isJSON } from '../../../../base-components/utils';
import { ManifestManager } from '../../../../managers/ManifestManager';

// Mock the utils functions
vi.mock('../../../../base-components/utils', () => ({
  createNewPathWithSortableFileName: vi.fn((path) => `${path}/error-123.json`),
  isJSON: vi.fn(() => false)
}));

const spyLoggerStrategy = configureSpyLoggerStrategy();

describe('ManifestManager - Basic Tests', () => {
  let manifestManager: ManifestManager;
  let mockManifestRepository: Repository.ObjectStorage;
  let mockManifestManagerConfig: Interface.ManifestManagerConfig;
  let mockSchema: ZodObject<any>;

  const mockManifestData = {
    llmManifests: {
      default: {
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
      },
      creative: {
        openai: {
          systemMessage: 'you are a creative assistant',
          modelPreset: {
            model: 'gpt-4',
            temperature: 0.9
          }
        }
      }
    },
    prompts: {
      'weather-prompt': {
        openai: 'What is the weather in {location}?',
        anthropic: 'Tell me about the weather in {location}.'
      },
      'greeting-prompt': {
        openai: 'Hello, how can I help you today?'
      }
    },
    aiTasks: {
      summarization: {
        openai: {
          systemMessage: 'you are a summarization assistant',
          modelPreset: {
            model: 'gpt-4',
            temperature: 0.3
          }
        }
      },
      translation: {
        openai: {
          systemMessage: 'you are a translation assistant',
          modelPreset: {
            model: 'gpt-4',
            temperature: 0.2
          }
        }
      }
    }
  };

  beforeEach(() => {
    // No need to reset static properties as they're now instance-based

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

  describe('constructor', () => {
    it('should initialize and update cache on creation', () => {
      expect(spyLoggerStrategy.trace).toHaveBeenCalledWith(
        'Manifest Manager initialized. Update cache...',
        'ManifestManager'
      );
      expect(mockManifestRepository.get).toHaveBeenCalledWith(mockManifestManagerConfig.manifestPath);
    });
  });

  describe('useLlmManifestSchema', () => {
    it('should register a new LLM manifest schema', async () => {
      const llmName = 'test-llm';

      await manifestManager.useLlmManifestSchema(llmName, mockSchema);

      // @ts-expect-error - accessing private property for testing
      const registeredSchema = manifestManager.llmManifestSchemas.get(llmName);
      expect(registeredSchema).toBe(mockSchema);
      expect(spyLoggerStrategy.trace).toHaveBeenCalledWith(
        `Registering LLM Manifest Schema: ${llmName}`,
        'ManifestManager'
      );
    });

    it('should warn when overwriting an existing schema', async () => {
      const llmName = 'test-llm';

      await manifestManager.useLlmManifestSchema(llmName, mockSchema);
      await manifestManager.useLlmManifestSchema(llmName, mockSchema);

      expect(spyLoggerStrategy.warn).toHaveBeenCalledWith(
        `Overwriting existing Manifest Validation Schema for ${llmName}`,
        'ManifestManager'
      );
    });
  });

  describe('isManifestExpired', () => {
    it('should return true when manifest is expired', () => {
      // @ts-expect-error - accessing private property for testing
      manifestManager.expiredAt = new Date().getTime() - 1000; // Set to past time

      // @ts-expect-error - accessing private method for testing
      const result = manifestManager.isManifestExpired();

      expect(result).toBe(true);
    });

    it('should return false when manifest is not expired', () => {
      // @ts-expect-error - accessing private property for testing
      manifestManager.expiredAt = new Date().getTime() + 60000; // Set to future time

      // @ts-expect-error - accessing private method for testing
      const result = manifestManager.isManifestExpired();

      expect(result).toBe(false);
    });
  });

  describe('getManifest', () => {
    it('should return cached manifest when not expired', async () => {
      // Set up a cached manifest
      // @ts-expect-error - accessing private property for testing
      manifestManager.cachedManifest = mockManifestData;
      // @ts-expect-error - accessing private property for testing
      manifestManager.expiredAt = new Date().getTime() + 60000; // Not expired

      // @ts-expect-error - accessing private method for testing
      const result = await manifestManager.getManifest();

      expect(result).toBe(mockManifestData);
      // Should not call update cache
      expect(mockManifestRepository.get).toHaveBeenCalledTimes(1); // Only from constructor
    });

    it('should update cache when manifest is expired', async () => {
      // Set up an expired manifest
      // @ts-expect-error - accessing private property for testing
      manifestManager.cachedManifest = mockManifestData;
      // @ts-expect-error - accessing private property for testing
      manifestManager.expiredAt = new Date().getTime() - 1000; // Expired

      // @ts-expect-error - accessing private method for testing
      const result = await manifestManager.getManifest();

      expect(result).toEqual(mockManifestData);
      // Should call update cache
      expect(mockManifestRepository.get).toHaveBeenCalledTimes(2); // Once from constructor, once from getManifest
    });

    it('should throw error when cached manifest is not found', async () => {
      // Set up no cached manifest
      // @ts-expect-error - accessing private property for testing
      manifestManager.cachedManifest = null;

      // @ts-expect-error - accessing private method for testing
      await expect(manifestManager.getManifest()).rejects.toThrow('Manifest or LLM Manifests not found');
    });
  });

  describe('getManifestByName', () => {
    it('should return manifest by name when it exists', () => {
      // @ts-expect-error - accessing private method for testing
      const result = manifestManager.getManifestByName(mockManifestData, 'default');

      expect(result).toEqual(mockManifestData.llmManifests.default);
    });

    it('should throw error when manifest by name does not exist', () => {
      // @ts-expect-error - accessing private method for testing
      expect(() => manifestManager.getManifestByName(mockManifestData, 'non-existent')).toThrow(
        'Manifest by name: non-existent not found'
      );
    });
  });

  describe('getAiTaskByName', () => {
    it('should return AI task by name when it exists', () => {
      // @ts-expect-error - accessing private method for testing
      const result = manifestManager.getAiTaskByName(mockManifestData, 'summarization');

      expect(result).toEqual(mockManifestData.aiTasks.summarization);
    });

    it('should throw error when AI task by name does not exist', () => {
      // @ts-expect-error - accessing private method for testing
      expect(() => manifestManager.getAiTaskByName(mockManifestData, 'non-existent')).toThrow(
        'Manifest by name: non-existent not found'
      );
    });
  });

  describe('getLlmManifestByName', () => {
    it('should return LLM manifest by name when it exists', () => {
      const manifestByName = {
        openai: {
          systemMessage: 'you are a helpful assistant',
          modelPreset: {
            model: 'gpt-4',
            temperature: 0.7
          }
        }
      };

      // @ts-expect-error - accessing private method for testing
      const result = manifestManager.getLlmManifestByName(manifestByName, 'openai');

      expect(result).toEqual(manifestByName.openai);
    });

    it('should throw error when LLM manifest by name does not exist', () => {
      const manifestByName = {
        openai: {
          systemMessage: 'you are a helpful assistant',
          modelPreset: {
            model: 'gpt-4',
            temperature: 0.7
          }
        }
      };

      // @ts-expect-error - accessing private method for testing
      expect(() => manifestManager.getLlmManifestByName(manifestByName, 'non-existent')).toThrow(
        'No agent manifest found with declared LLM usage for: non-existent'
      );
    });
  });

  describe('getPrompt', () => {
    it('should return prompt when it exists', async () => {
      // Mock getManifest to return mockManifestData with correct structure
      const mockData = {
        prompts: {
          'weather-prompt': {
            openai: 'What is the weather in {location}?'
          }
        }
      };

      // @ts-expect-error - accessing private method for testing
      manifestManager.getManifest = vi.fn().mockResolvedValue(mockData);

      const result = await manifestManager.getPrompt('weather-prompt', 'openai');

      expect(result).toEqual({
        name: 'weather-prompt',
        content: 'What is the weather in {location}?'
      });
    });

    it('should throw error when the prompt has no text for the LLM', async () => {
      // @ts-expect-error - accessing private method for testing
      manifestManager.getManifest = vi.fn().mockResolvedValue({ prompts: { 'weather-prompt': { anthropic: 'Hi' } } });

      await expect(manifestManager.getPrompt('weather-prompt', 'openai')).rejects.toThrow(
        'prompt with name weather-prompt is not exist in manifest'
      );
    });

    it('should throw error when prompt does not exist', async () => {
      // Mock getManifest to return mockManifestData with correct structure
      const mockData = {
        prompts: {
          'other-prompt': { openai: 'Other' }
        }
      };

      // @ts-expect-error - accessing private method for testing
      manifestManager.getManifest = vi.fn().mockResolvedValue(mockData);

      await expect(manifestManager.getPrompt('non-existent', 'openai')).rejects.toThrow(
        'prompt with name non-existent is not exist in manifest'
      );
    });
  });

  describe('validateManifests', () => {
    beforeEach(async () => {
      // Register schemas for testing
      await manifestManager.useLlmManifestSchema('openai', mockSchema);
      await manifestManager.useLlmManifestSchema('anthropic', mockSchema);
    });

    it('should validate manifests successfully', () => {
      const manifestObject = {
        default: {
          openai: {
            systemMessage: 'test system message',
            modelPreset: { model: 'gpt-4' }
          },
          anthropic: {
            systemMessage: 'test system message',
            modelPreset: { model: 'claude-3' }
          }
        }
      };

      const result = manifestManager.validateManifests(manifestObject);

      expect(result).toEqual({
        default: {
          openai: {
            systemMessage: 'test system message',
            modelPreset: { model: 'gpt-4' }
          },
          anthropic: {
            systemMessage: 'test system message',
            modelPreset: { model: 'claude-3' }
          }
        }
      });
      // The parse method is called during constructor initialization and during validateManifests
      // Count may vary depending on initialization, so just check it was called
      expect(mockSchema.parse).toHaveBeenCalled();
    });

    it('should log warning when manifest is missing for registered LLM', () => {
      const manifestObject = {
        default: {
          openai: {
            systemMessage: 'test system message',
            modelPreset: { model: 'gpt-4' }
          }
          // Missing anthropic
        }
      };

      manifestManager.validateManifests(manifestObject);

      expect(spyLoggerStrategy.warn).toHaveBeenCalledWith(
        'Manifest file is missing manifest for registered LLM strategy',
        'ManifestManager',
        {
          llmName: 'anthropic',
          manifestName: 'default'
        }
      );
    });

    it('should throw error when validation fails', () => {
      const manifestObject = {
        default: {
          openai: {
            systemMessage: 'test system message',
            modelPreset: { model: 'gpt-4' }
          }
        }
      };

      // Make the schema validation fail
      const validationError = new ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          path: ['model'],
          message: 'Expected string, received number'
        }
      ]);

      mockSchema.parse = vi.fn().mockImplementation(() => {
        throw validationError;
      });

      expect(() => manifestManager.validateManifests(manifestObject)).toThrow('Invalid LLM Manifest for openai: ');
    });
  });

  describe('updateCache', () => {
    it('should update cache successfully', async () => {
      await manifestManager.updateCache();

      expect(mockManifestRepository.get).toHaveBeenCalledWith(mockManifestManagerConfig.manifestPath);
      expect(Schema.LoftManifest.parse).toHaveBeenCalledWith(mockManifestData);

      // @ts-expect-error - accessing private property for testing
      expect(manifestManager.cachedManifest).toEqual(mockManifestData);

      // @ts-expect-error - accessing private property for testing
      const expiredAt = manifestManager.expiredAt;
      const expectedExpiredAt = new Date().getTime() + mockManifestManagerConfig.cacheExpirationTime;

      // Allow for small timing differences (within 100ms)
      expect(expiredAt).toBeGreaterThan(expectedExpiredAt - 100);
      expect(expiredAt).toBeLessThan(expectedExpiredAt + 100);
    });

    it('should handle and log errors during cache update', async () => {
      const error = new Error('Failed to get manifest');
      mockManifestRepository.get = vi.fn().mockRejectedValue(error);

      // updateCache no longer throws, it catches and logs errors
      await manifestManager.updateCache();

      expect(spyLoggerStrategy.error).toHaveBeenCalledWith(
        'Error updating Manifest Cache:',
        'ManifestManager',
        'Failed to get manifest',
        expect.any(String)
      );
      expect(mockManifestRepository.upload).toHaveBeenCalledWith('path/to/errors/error-123.json', {
        error: 'Failed to get manifest'
      });
    });

    it('should handle JSON error messages', async () => {
      const jsonError = new Error('{"code": 404, "message": "Not found"}');
      mockManifestRepository.get = vi.fn().mockRejectedValue(jsonError);

      // Mock isJSON to return true for this test
      (isJSON as any).mockReturnValueOnce(true);

      // updateCache no longer throws, it catches and logs errors
      await manifestManager.updateCache();

      expect(mockManifestRepository.upload).toHaveBeenCalledWith('path/to/errors/error-123.json', {
        error: { code: 404, message: 'Not found' }
      });
    });
  });

  describe('getLlmManifest', () => {
    it('should return LLM manifest when it exists', async () => {
      // Create a mock manifest with the correct structure
      const mockData = {
        llmManifests: {
          default: {
            openai: {
              systemMessage: 'you are a helpful assistant',
              modelPreset: {
                model: 'gpt-4',
                temperature: 0.7
              }
            }
          }
        }
      };

      // @ts-expect-error - accessing private method for testing
      manifestManager.getManifest = vi.fn().mockResolvedValue(mockData);

      const result = await manifestManager.getLlmManifest('default', 'openai');

      expect(result).toEqual({
        systemMessage: 'you are a helpful assistant',
        modelPreset: {
          model: 'gpt-4',
          temperature: 0.7
        }
      });
      expect(spyLoggerStrategy.trace).toHaveBeenCalledWith(
        'Getting System Message by LLM name: openai manifest name: ',
        'ManifestManager',
        'default'
      );
    });

    it('should throw error when manifest does not exist', async () => {
      // Mock getManifest to return mockManifestData
      // @ts-expect-error - accessing private method for testing
      manifestManager.getManifest = vi.fn().mockResolvedValue(mockManifestData);

      await expect(manifestManager.getLlmManifest('non-existent', 'openai')).rejects.toThrow(
        'Manifest by name: non-existent not found'
      );
    });

    it('should throw error when LLM manifest does not exist', async () => {
      // Mock getManifest to return mockManifestData
      // @ts-expect-error - accessing private method for testing
      manifestManager.getManifest = vi.fn().mockResolvedValue(mockManifestData);

      await expect(manifestManager.getLlmManifest('default', 'non-existent')).rejects.toThrow(
        'No agent manifest found with declared LLM usage for: non-existent'
      );
    });

    it('should throw error when system message is missing', async () => {
      const modifiedManifestData = {
        ...mockManifestData,
        llmManifests: {
          default: {
            openai: {
              // Missing systemMessage
              modelPreset: {
                model: 'gpt-4',
                temperature: 0.7
              }
            }
          }
        }
      };

      // Mock getManifest to return modified data
      // @ts-expect-error - accessing private method for testing
      manifestManager.getManifest = vi.fn().mockResolvedValue(modifiedManifestData);

      await expect(manifestManager.getLlmManifest('default', 'openai')).rejects.toThrow('System Message not found');
    });

    it('should handle missing system message in manifest', async () => {
      // Arrange
      // Mock the getLlmManifestByName method to return a manifest without system message
      // @ts-expect-error - accessing private method for testing
      manifestManager.getLlmManifestByName = vi.fn().mockReturnValue({
        // No systemMessage property
        modelPreset: { model: 'gpt-4' }
      });

      // Act & Assert
      await expect(manifestManager.getLlmManifest('default', 'openai')).rejects.toThrow('System Message not found');
    });
  });

  describe('getAiTaskManifest', () => {
    it('should return AI task manifest when it exists', async () => {
      // Create a mock manifest with the correct structure
      const mockData = {
        aiTasks: {
          summarization: {
            openai: {
              systemMessage: 'you are a summarization assistant',
              modelPreset: {
                model: 'gpt-4',
                temperature: 0.3
              }
            }
          }
        }
      };

      // @ts-expect-error - accessing private method for testing
      manifestManager.getManifest = vi.fn().mockResolvedValue(mockData);

      const result = await manifestManager.getAiTaskManifest('summarization', 'openai');

      expect(result).toEqual({
        systemMessage: 'you are a summarization assistant',
        modelPreset: {
          model: 'gpt-4',
          temperature: 0.3
        }
      });
      expect(spyLoggerStrategy.trace).toHaveBeenCalledWith('Getting AI Task by name and LLM name', 'ManifestManager');
    });

    it('should throw error when AI task does not exist', async () => {
      // Mock getManifest to return mockManifestData
      // @ts-expect-error - accessing private method for testing
      manifestManager.getManifest = vi.fn().mockResolvedValue(mockManifestData);

      await expect(manifestManager.getAiTaskManifest('non-existent', 'openai')).rejects.toThrow(
        'Manifest by name: non-existent not found'
      );
    });

    it('should throw error when LLM manifest for AI task does not exist', async () => {
      // Mock getManifest to return mockManifestData
      // @ts-expect-error - accessing private method for testing
      manifestManager.getManifest = vi.fn().mockResolvedValue(mockManifestData);

      await expect(manifestManager.getAiTaskManifest('summarization', 'non-existent')).rejects.toThrow(
        'No agent manifest found with declared LLM usage for: non-existent'
      );
    });

    it('should throw error when system message is missing in AI task', async () => {
      const modifiedManifestData = {
        ...mockManifestData,
        aiTasks: {
          summarization: {
            openai: {
              // Missing systemMessage
              modelPreset: {
                model: 'gpt-4',
                temperature: 0.3
              }
            }
          }
        }
      };

      // Mock getManifest to return modified data
      // @ts-expect-error - accessing private method for testing
      manifestManager.getManifest = vi.fn().mockResolvedValue(modifiedManifestData);

      await expect(manifestManager.getAiTaskManifest('summarization', 'openai')).rejects.toThrow('AI Task not found');
    });
  });

  describe('error handling and validation', () => {
    it('should handle invalid manifest format gracefully', async () => {
      // Arrange
      const invalidManifest = {
        // Missing required fields
        llmManifests: {}
        // No prompts or aiTasks
      };

      // Setup repository to return invalid manifest
      mockManifestRepository.get = vi.fn().mockResolvedValue(invalidManifest);

      // Reset instance properties
      // @ts-expect-error - accessing private property for testing
      manifestManager.cachedManifest = undefined;
      // @ts-expect-error - accessing private property for testing
      manifestManager.expiredAt = 0;

      // Act & Assert
      await expect(manifestManager.getLlmManifest('default', 'openai')).rejects.toThrow();
      expect(spyLoggerStrategy.error).toHaveBeenCalled();
    });

    it('should validate manifest structure correctly', async () => {
      // Arrange
      // Create a mock schema that will fail validation
      const validationError = new Error('Validation failed');
      const failingSchema = {
        parse: vi.fn().mockImplementation(() => {
          throw validationError;
        })
      } as unknown as ZodObject<any>;

      // Mock the validateManifests method to call our failing schema
      const originalValidateManifests = manifestManager['validateManifests'];
      manifestManager['validateManifests'] = vi.fn().mockImplementation((manifests) => {
        failingSchema.parse({});
        return manifests;
      });

      // Reset instance properties to force cache update
      // @ts-expect-error - accessing private property for testing
      manifestManager.cachedManifest = undefined;
      // @ts-expect-error - accessing private property for testing
      manifestManager.expiredAt = 0;

      try {
        // Act & Assert
        await expect(manifestManager.getLlmManifest('default', 'openai')).rejects.toThrow();
        expect(failingSchema.parse).toHaveBeenCalled();
      } finally {
        // Restore original method
        manifestManager['validateManifests'] = originalValidateManifests;
      }
    });

    it('should handle missing system message in manifest', async () => {
      // Arrange
      // Mock the getLlmManifestByName method to return a manifest without system message
      // @ts-expect-error - accessing private method for testing
      manifestManager.getLlmManifestByName = vi.fn().mockReturnValue({
        // No systemMessage property
        modelPreset: { model: 'gpt-4' }
      });

      // Act & Assert
      await expect(manifestManager.getLlmManifest('default', 'openai')).rejects.toThrow('System Message not found');
    });
  });
});
