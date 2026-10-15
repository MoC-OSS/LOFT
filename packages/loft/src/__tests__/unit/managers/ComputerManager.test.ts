import { Interface } from '@moc-global/loft-definitions';
import { configureSpyLoggerStrategy } from '@moc-global/loft-test-suite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComputerManager } from '../../../managers/ComputerManager';

const spyLoggerStrategy = configureSpyLoggerStrategy();

// Define a type for our test context
type TestContext = {
  value: string;
  tracer?: any;
};

// Create mock tracer
const createMockTracer = () => {
  const mockSpan = {
    id: 'mock-span-id',
    end: vi.fn(),
    span: vi.fn(),
    generation: vi.fn(),
    event: vi.fn()
  };

  const mockTracer = {
    span: vi.fn().mockReturnValue(mockSpan),
    withParent: vi.fn().mockReturnThis(),
    generation: vi.fn(),
    event: vi.fn(),
    score: vi.fn(),
    update: vi.fn(),
    flushAsync: vi.fn().mockResolvedValue(undefined)
  };

  return { mockTracer, mockSpan };
};

describe('ComputerManager', () => {
  let computerManager: ComputerManager<TestContext>;
  let mockHandler: Interface.PromptComputer<TestContext>;
  let mockTracer: any;
  let mockSpan: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock tracer
    const tracerMocks = createMockTracer();
    mockTracer = tracerMocks.mockTracer;
    mockSpan = tracerMocks.mockSpan;

    // Create a new instance for each test
    computerManager = new ComputerManager<TestContext>('test');

    // Create a mock handler
    mockHandler = vi.fn().mockImplementation(async (ctx, prompt) => {
      return `Computed: ${prompt.content} with context ${ctx.value}`;
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('use', () => {
    it('should register a handler successfully', () => {
      // Act
      computerManager.use('manifest1', 'llm1', mockHandler);

      // Assert
      expect(spyLoggerStrategy.trace).toHaveBeenCalledWith(
        'Registering System Message Handler: manifest1-llm1',
        'ComputerManager:test'
      );
    });

    it('should throw an error when registering a handler with the same name', () => {
      // Arrange
      computerManager.use('manifest1', 'llm1', mockHandler);

      // Act & Assert
      expect(() => {
        computerManager.use('manifest1', 'llm1', mockHandler);
      }).toThrow('A System Message Handler with the name "manifest1-llm1" already exists.');
    });

    it('should allow registering handlers with different names', () => {
      // Act
      computerManager.use('manifest1', 'llm1', mockHandler);
      computerManager.use('manifest1', 'llm2', mockHandler);
      computerManager.use('manifest2', 'llm1', mockHandler);

      // Assert
      expect(spyLoggerStrategy.trace).toHaveBeenCalledTimes(3);
    });
  });

  describe('compute', () => {
    it('should return the original system message when no handler is found', async () => {
      // Arrange
      const systemMessage = 'Original system message';
      const context: TestContext = { value: 'test', tracer: mockTracer };

      // Act
      const result = await computerManager.compute(context, systemMessage, 'unknown', 'unknown');

      // Assert
      expect(result).toBe(systemMessage);
      expect(spyLoggerStrategy.trace).toHaveBeenCalledWith(
        'Computing Prompt: unknown, LLM Name: unknown',
        'ComputerManager:test'
      );
    });

    it('should call the handler and return the computed message when handler exists', async () => {
      // Arrange
      const systemMessage = 'Original system message';
      const context: TestContext = { value: 'test', tracer: mockTracer };
      computerManager.use('manifest1', 'llm1', mockHandler);

      // Act
      const result = await computerManager.compute(context, systemMessage, 'manifest1', 'llm1');

      // Assert
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({ value: 'test' }),
        { name: 'manifest1', content: systemMessage },
        {}
      );
      expect(result).toBe('Computed: Original system message with context test');
      expect(spyLoggerStrategy.trace).toHaveBeenCalledWith(
        'Computing Prompt: manifest1, LLM Name: llm1',
        'ComputerManager:test'
      );
      expect(mockSpan.end).toHaveBeenCalledWith({
        output: 'Computed: Original system message with context test',
        level: 'DEFAULT'
      });
    });

    it('should pass model preset to the handler when provided', async () => {
      // Arrange
      const systemMessage = 'Original system message';
      const context: TestContext = { value: 'test', tracer: mockTracer };
      const modelPreset = { temperature: 0.7, model: 'gpt-4' };
      computerManager.use('manifest1', 'llm1', mockHandler);

      // Act
      const result = await computerManager.compute(context, systemMessage, 'manifest1', 'llm1', modelPreset);

      // Assert
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({ value: 'test' }),
        { name: 'manifest1', content: systemMessage },
        modelPreset
      );
      expect(result).toBe('Computed: Original system message with context test');
    });

    it('should handle empty system message', async () => {
      // Arrange
      const systemMessage = '';
      const context: TestContext = { value: 'test', tracer: mockTracer };
      computerManager.use('manifest1', 'llm1', mockHandler);

      // Act
      const result = await computerManager.compute(context, systemMessage, 'manifest1', 'llm1');

      // Assert
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({ value: 'test' }),
        { name: 'manifest1', content: '' },
        {}
      );
      expect(result).toBe('Computed:  with context test');
    });

    it('should handle undefined model preset', async () => {
      // Arrange
      const systemMessage = 'Original system message';
      const context: TestContext = { value: 'test', tracer: mockTracer };
      computerManager.use('manifest1', 'llm1', mockHandler);

      // Act
      const result = await computerManager.compute(context, systemMessage, 'manifest1', 'llm1', undefined);

      // Assert
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({ value: 'test' }),
        { name: 'manifest1', content: systemMessage },
        {}
      );
      expect(result).toBe('Computed: Original system message with context test');
    });
  });

  describe('getCombinedName', () => {
    it('should combine manifest name and llm name correctly', () => {
      // Use a private method through a public method that uses it
      computerManager.use('manifest1', 'llm1', mockHandler);

      // Verify the combined name was used in the logger call
      expect(spyLoggerStrategy.trace).toHaveBeenCalledWith(
        'Registering System Message Handler: manifest1-llm1',
        'ComputerManager:test'
      );
    });
  });

  describe('getHandler', () => {
    it('should return undefined when no handler is found', async () => {
      // This is indirectly tested through compute
      const systemMessage = 'Original system message';
      const context: TestContext = { value: 'test', tracer: mockTracer };

      const result = await computerManager.compute(context, systemMessage, 'unknown', 'unknown');

      expect(result).toBe(systemMessage);
    });

    it('should return the correct handler when it exists', async () => {
      // This is indirectly tested through compute
      const systemMessage = 'Original system message';
      const context: TestContext = { value: 'test', tracer: mockTracer };
      computerManager.use('manifest1', 'llm1', mockHandler);

      const result = await computerManager.compute(context, systemMessage, 'manifest1', 'llm1');

      expect(result).not.toBe(systemMessage);
      expect(mockHandler).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle handler that throws an error', async () => {
      // Arrange
      const errorHandler: Interface.PromptComputer<TestContext> = vi.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      const systemMessage = 'Original system message';
      const context: TestContext = { value: 'test', tracer: mockTracer };
      computerManager.use('manifest1', 'llm1', errorHandler);

      // Act & Assert
      await expect(computerManager.compute(context, systemMessage, 'manifest1', 'llm1')).rejects.toThrow(
        'Handler error'
      );
    });

    it('should handle handler that returns a rejected promise', async () => {
      // Arrange
      const errorHandler: Interface.PromptComputer<TestContext> = vi
        .fn()
        .mockRejectedValue(new Error('Promise rejection'));
      const systemMessage = 'Original system message';
      const context: TestContext = { value: 'test', tracer: mockTracer };
      computerManager.use('manifest1', 'llm1', errorHandler);

      // Act & Assert
      await expect(computerManager.compute(context, systemMessage, 'manifest1', 'llm1')).rejects.toThrow(
        'Promise rejection'
      );
    });

    it('should handle special characters in manifest and llm names', () => {
      // Arrange & Act
      computerManager.use('manifest-with-dashes', 'llm_with_underscores', mockHandler);

      // Assert
      expect(spyLoggerStrategy.trace).toHaveBeenCalledWith(
        'Registering System Message Handler: manifest-with-dashes-llm_with_underscores',
        'ComputerManager:test'
      );
    });

    it('should handle empty manifest and llm names', () => {
      // Arrange & Act & Assert
      expect(() => {
        computerManager.use('', '', mockHandler);
      }).not.toThrow();
      expect(spyLoggerStrategy.trace).toHaveBeenCalledWith(
        'Registering System Message Handler: -',
        'ComputerManager:test'
      );
    });

    it('should handle null values in promptCtx', async () => {
      // Arrange
      const nullContextHandler: Interface.PromptComputer<TestContext> = vi
        .fn()
        .mockImplementation(async (ctx, prompt) => {
          // This handler should work even if ctx has null properties
          return `Handled with ${ctx?.value || 'undefined value'} for prompt ${prompt.name}`;
        });
      const systemMessage = 'Test message';
      const nullContext = { value: null, tracer: mockTracer } as unknown as TestContext;
      computerManager.use('manifest1', 'llm1', nullContextHandler);

      // Act
      const result = await computerManager.compute(nullContext, systemMessage, 'manifest1', 'llm1');

      // Assert
      expect(nullContextHandler).toHaveBeenCalled();
      expect(result).toBe('Handled with undefined value for prompt manifest1');
    });

    it('should handle null systemMessage', async () => {
      // Arrange
      const context: TestContext = { value: 'test', tracer: mockTracer };
      const nullSystemMessage = null as unknown as string;
      computerManager.use('manifest1', 'llm1', mockHandler);

      // Act
      const result = await computerManager.compute(context, nullSystemMessage, 'manifest1', 'llm1');

      // Assert
      expect(mockHandler).toHaveBeenCalledWith(context, { name: 'manifest1', content: nullSystemMessage }, {});
      expect(result).toBe('Computed: null with context test');
    });

    it('should handle large and complex modelPreset objects', async () => {
      // Arrange
      const systemMessage = 'Test message';
      const context: TestContext = { value: 'test', tracer: mockTracer };
      const complexModelPreset = {
        temperature: 0.7,
        model: 'gpt-4',
        maxTokens: 8000,
        topP: 0.95,
        frequencyPenalty: 0.8,
        presencePenalty: 0.8,
        stop: ['###', '---', '```'],
        nestedObject: {
          level1: {
            level2: {
              level3: {
                deepValue: 'very deep',
                array: Array(100).fill('item')
              }
            }
          }
        },
        largeArray: Array(1000).fill({ key: 'value' })
      };
      computerManager.use('manifest1', 'llm1', mockHandler);

      // Act
      const result = await computerManager.compute(context, systemMessage, 'manifest1', 'llm1', complexModelPreset);

      // Assert
      expect(mockHandler).toHaveBeenCalledWith(
        context,
        { name: 'manifest1', content: systemMessage },
        complexModelPreset
      );
      expect(result).toBe('Computed: Test message with context test');
    });

    it('should handle concurrent compute calls correctly', async () => {
      // Arrange
      const delayedHandler: Interface.PromptComputer<TestContext> = vi.fn().mockImplementation(async (ctx, prompt) => {
        // Simulate async delay
        await new Promise((resolve) => setTimeout(resolve, 10));
        return `Computed: ${prompt.content} with context ${ctx.value}`;
      });
      const context: TestContext = { value: 'test', tracer: mockTracer };
      computerManager.use('manifest1', 'llm1', delayedHandler);

      // Act - run multiple compute calls concurrently
      const results = await Promise.all([
        computerManager.compute(context, 'Message 1', 'manifest1', 'llm1'),
        computerManager.compute(context, 'Message 2', 'manifest1', 'llm1'),
        computerManager.compute(context, 'Message 3', 'manifest1', 'llm1')
      ]);

      // Assert
      expect(delayedHandler).toHaveBeenCalledTimes(3);
      expect(results).toEqual([
        'Computed: Message 1 with context test',
        'Computed: Message 2 with context test',
        'Computed: Message 3 with context test'
      ]);
    });
  });
});
