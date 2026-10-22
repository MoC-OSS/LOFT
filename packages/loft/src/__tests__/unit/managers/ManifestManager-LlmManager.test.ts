import 'reflect-metadata';

import { Chat, ContextInterface, Interface, Repository, Schema, Strategy, Type } from '@moc-global/loft-definitions';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodObject } from 'zod';

import { NoOpTracerStrategy } from '../../../base-components';
import { LlmManager } from '../../../managers/LlmManager';
import { ManifestManager } from '../../../managers/ManifestManager';

describe('ManifestManager and LlmManager Integration', () => {
  let manifestManager: ManifestManager;
  let llmManager: LlmManager;
  let mockManifestRepository: Repository.ObjectStorage;
  let mockManifestManagerConfig: Interface.ManifestManagerConfig;
  let mockSchema: ZodObject<any>;
  let mockComputerManager: Interface.ComputerManager<ContextInterface>;
  let mockOpenAiLlm: Type.LLM.LoftLLM;
  let mockAnthropicLlm: Type.LLM.LoftLLM;
  let mockContext: ContextInterface;
  let mockMCPManager: Interface.MCP.MCPManager;
  let mockLlmContextWindowCropper: Strategy.LlmContextWindowCropper;
  let mockToolInterceptorManager: Interface.ToolInterceptorManager;

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
      }
    }
  };

  beforeEach(async () => {
    // No need to reset static properties as they're now instance-based

    // Setup mock repositories and config
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

    // Create mock context with chat history
    const tracerStrategy = new NoOpTracerStrategy();
    const tracer = tracerStrategy.createTracer({
      traceId: 'test-trace-id',
      name: 'test-tracer',
      sessionId: 'test-session-id'
    });

    mockContext = {
      request: {
        correlatorIds: ['test-correlator-id'],
        generateRequestParameters: {},
        messages: {
          augmentedContext: [],
          directMessages: []
        }
      },
      session: {
        id: 'test-session-id',
        manifestName: 'default',
        llmName: 'openai',
        currentLlmName: 'openai',
        currentManifestName: 'default'
      },
      chatHistory: {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            createdAt: new Date(),
            updatedAt: new Date(),
            sequenceId: '1',
            sessionId: 'test-session-id',
            ctx: {},
            author: 'user',
            llmName: 'openai',
            manifestName: 'default',
            llmIgnore: false
          }
        ]
      },
      tracer: tracer
    } as unknown as ContextInterface;

    // Mock LLMs
    mockOpenAiLlm = {
      generate: vi.fn().mockResolvedValue({
        content: 'OpenAI response',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        llmBody: { content: 'OpenAI response' }
      }),
      generateStream: vi.fn().mockResolvedValue({
        stream: vi.fn().mockImplementation((callback) => {
          callback({ content: 'OpenAI streaming response', done: false });
          callback({ content: '', done: true });
          return Promise.resolve();
        }),
        abort: vi.fn()
      }),
      generateQueued: vi.fn().mockResolvedValue(undefined),
      generateModelPresetSchema: vi.fn().mockReturnValue(mockSchema),
      prepareGenerateRequest: vi.fn().mockResolvedValue({
        correlatorIds: ['test-correlator-id'],
        sessionId: 'test-session-id',
        messages: [],
        systemMessage: 'you are a helpful assistant',
        modelPreset: { model: 'gpt-4' },
        priority: 30,
        llmBody: {}
      }),
      executeMiddlewareChain: vi.fn().mockImplementation((ctx, response) => Promise.resolve(response)),
      formatToUnifiedLLMResponse: vi.fn().mockImplementation((correlatorIds, sessionId, llmBody) =>
        Promise.resolve({
          content: llmBody.content,
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          topChoice: {
            id: 'test-message-id',
            sessionId: sessionId,
            role: Type.LLM.UnifiedMessageRole.assistant,
            author: 'assistant',
            content: [{ type: 'text', text: llmBody.content || 'OpenAI response' }],
            ctx: {},
            llmName: 'openai',
            manifestName: 'default',
            sequenceId: '1',
            llmIgnore: false,
            createdAt: new Date(),
            updatedAt: new Date()
          },
          choices: []
        })
      ),
      getHealthCheckStatus: vi.fn().mockResolvedValue(true)
    } as unknown as Type.LLM.LoftLLM;

    mockAnthropicLlm = {
      generate: vi.fn().mockResolvedValue({
        content: 'Anthropic response',
        usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
        llmBody: { content: 'Anthropic response' }
      }),
      generateStream: vi.fn().mockResolvedValue({
        stream: vi.fn().mockImplementation((callback) => {
          callback({ content: 'Anthropic streaming response', done: false });
          callback({ content: '', done: true });
          return Promise.resolve();
        }),
        abort: vi.fn()
      }),
      generateQueued: vi.fn().mockResolvedValue(undefined),
      generateModelPresetSchema: vi.fn().mockReturnValue(mockSchema),
      prepareGenerateRequest: vi.fn().mockResolvedValue({
        correlatorIds: ['test-correlator-id'],
        sessionId: 'test-session-id',
        messages: [],
        systemMessage: 'you are a helpful assistant from Anthropic',
        modelPreset: { model: 'claude-3' },
        priority: 30,
        llmBody: {}
      }),
      executeMiddlewareChain: vi.fn().mockImplementation((ctx, response) => Promise.resolve(response)),
      formatToUnifiedLLMResponse: vi.fn().mockImplementation((correlatorIds, sessionId, llmBody) =>
        Promise.resolve({
          content: llmBody.content,
          usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
          topChoice: {
            id: 'test-message-id',
            sessionId: sessionId,
            role: Type.LLM.UnifiedMessageRole.assistant,
            author: 'assistant',
            content: [{ type: 'text', text: llmBody.content || 'Anthropic response' }],
            ctx: {},
            llmName: 'anthropic',
            manifestName: 'default',
            sequenceId: '1',
            llmIgnore: false,
            createdAt: new Date(),
            updatedAt: new Date()
          },
          choices: []
        })
      ),
      getHealthCheckStatus: vi.fn().mockResolvedValue(true)
    } as unknown as Type.LLM.LoftLLM;

    // Create ManifestManager
    manifestManager = new ManifestManager(mockManifestRepository, mockManifestManagerConfig);

    // Spy on methods
    vi.spyOn(manifestManager, 'useLlmManifestSchema');
    vi.spyOn(manifestManager, 'getPrompt');
    vi.spyOn(manifestManager, 'getAiTaskManifest');

    // Create mock computer managers
    mockComputerManager = {
      compute: vi.fn().mockResolvedValue('computed system message')
    } as unknown as Interface.ComputerManager<ContextInterface>;

    // Create mock MCP manager
    mockMCPManager = {
      callTool: vi.fn().mockResolvedValue({
        isError: false,
        content: [{ result: 'success' }]
      }),
      useClient: vi.fn(),
      listsOfTools: vi.fn().mockResolvedValue([]),
      listTools: vi.fn().mockResolvedValue([])
    } as unknown as Interface.MCP.MCPManager;

    // Create mock LlmContextWindowCropper - returns messages as-is without changes
    mockLlmContextWindowCropper = {
      crop: vi.fn().mockImplementation((messages) => messages)
    } as unknown as Strategy.LlmContextWindowCropper;

    // Create mock ToolInterceptorManager
    mockToolInterceptorManager = {
      handle: vi.fn().mockImplementation(async ({ toolResponse }) => toolResponse)
    } as unknown as Interface.ToolInterceptorManager;

    // Create LlmManager with ManifestManager
    llmManager = new LlmManager(
      manifestManager,
      mockComputerManager,
      mockComputerManager,
      mockComputerManager,
      mockMCPManager,
      mockLlmContextWindowCropper,
      mockToolInterceptorManager,
      undefined // chatConfig
    );

    // Register LLM strategies
    await llmManager.use('openai', mockOpenAiLlm, true);
    await llmManager.use('anthropic', mockAnthropicLlm, true);
  });

  describe('LlmManager using ManifestManager', () => {
    it('should create LLM with model preset from manifest', async () => {
      // Act
      const llm = llmManager.get('openai');

      // Assert
      expect(llm).toBe(mockOpenAiLlm);
      expect(manifestManager.useLlmManifestSchema).toHaveBeenCalledWith('openai', expect.any(Object));
    });

    it('should use system message from manifest', async () => {
      // Arrange
      const messages: Type.Entity.CreateMessage[] = [
        {
          role: Type.LLM.UnifiedMessageRole.user,
          content: [{ type: 'text' as const, text: 'Hello' }],
          sessionId: 'test-session',
          ctx: {},
          author: 'user',
          llmName: 'openai',
          manifestName: 'default',
          llmIgnore: false
        }
      ];

      // Act
      await llmManager.generate(mockContext, 'openai', 'default', messages);

      // Assert
      // Check that the system message was added from the manifest
      expect(mockOpenAiLlm.generate).toHaveBeenCalled();
      expect(mockComputerManager.compute).toHaveBeenCalledWith(
        mockContext,
        'you are a helpful assistant',
        'default',
        'openai',
        expect.any(Object)
      );
    });

    it('should handle switching between different LLMs', async () => {
      // Act
      const openaiLlm = llmManager.get('openai');
      const anthropicLlm = llmManager.get('anthropic');

      // Assert
      expect(openaiLlm).toBe(mockOpenAiLlm);
      expect(anthropicLlm).toBe(mockAnthropicLlm);
    });

    it('should handle manifest updates affecting LLM configuration', async () => {
      // Arrange
      // First, use the initial manifest
      const initialLlm = llmManager.get('openai');

      // Now update the manifest with new settings
      const updatedManifest = {
        llmManifests: {
          default: {
            openai: {
              systemMessage: 'you are an updated assistant',
              modelPreset: {
                model: 'gpt-4-turbo',
                temperature: 0.8
              }
            }
          }
        },
        prompts: {},
        aiTasks: {}
      };

      // Update the mock repository to return the updated manifest
      mockManifestRepository.get = vi.fn().mockResolvedValue(updatedManifest);

      // Reset the cache to force a refresh by accessing instance properties
      // @ts-expect-error - accessing private property for testing
      manifestManager.cachedManifest = undefined;
      // @ts-expect-error - accessing private property for testing
      manifestManager.expiredAt = 0;

      // Act
      const messages = [
        {
          role: Type.LLM.UnifiedMessageRole.user,
          content: [{ type: 'text' as const, text: 'Hello' }],
          sessionId: 'test-session',
          ctx: {},
          author: 'user',
          llmName: 'openai',
          manifestName: 'default',
          llmIgnore: false
        }
      ];
      await llmManager.generate(mockContext, 'openai', 'default', messages);

      // Assert
      // Should still use the same LLM instance
      expect(initialLlm).toBe(mockOpenAiLlm);
      // But with updated configuration from the manifest
      expect(mockOpenAiLlm.generate).toHaveBeenCalled();
      expect(mockComputerManager.compute).toHaveBeenCalledWith(
        mockContext,
        'you are an updated assistant',
        'default',
        'openai',
        expect.any(Object)
      );
    });

    it('should handle errors from ManifestManager', async () => {
      // Arrange
      // Mock ManifestManager to throw an error
      manifestManager.getLlmManifest = vi.fn().mockRejectedValue(new Error('Manifest not found'));

      // Act & Assert
      const messages = [
        {
          role: Type.LLM.UnifiedMessageRole.user,
          content: [{ type: 'text' as const, text: 'Hello' }],
          sessionId: 'test-session',
          ctx: {},
          author: 'user',
          llmName: 'openai',
          manifestName: 'default',
          llmIgnore: false
        }
      ];
      await expect(llmManager.generate(mockContext, 'openai', 'default', messages)).rejects.toThrow(
        'Manifest not found'
      );
    });

    it('should throw error when LLM strategy does not exist', () => {
      // Act & Assert
      expect(() => llmManager.get('non-existent-llm')).toThrow(
        'An Llm Strategy with the name "non-existent-llm" does not exists.'
      );
    });

    it('should warn when registering an existing LLM strategy without forceOverwrite', async () => {
      // Arrange
      const newLlm = { ...mockOpenAiLlm };

      // Act
      await llmManager.use('openai', newLlm, false);

      // Assert - strategy should not be replaced when forceOverwrite is false
      // (logging is now internal to the LlmManager)
      expect(llmManager.get('openai')).toBe(mockOpenAiLlm);
    });

    it('should overwrite an existing LLM strategy when forceOverwrite is true', async () => {
      // Arrange
      const newLlm = { ...mockOpenAiLlm };

      // Act
      await llmManager.use('openai', newLlm, true);

      // Assert - strategy should be replaced when forceOverwrite is true
      expect(llmManager.get('openai')).toBe(newLlm);
    });

    it('should execute AI task with string content', async () => {
      // Arrange
      const content = 'Summarize this text';

      // Mock getAiTaskManifest to return a valid manifest
      manifestManager.getAiTaskManifest = vi.fn().mockResolvedValue({
        systemMessage: 'you are a summarization assistant',
        modelPreset: { model: 'gpt-4', temperature: 0.3 }
      });

      // Act
      const result = await llmManager.aiTask(mockContext, 'openai', 'summarization', content);

      // Assert
      expect(manifestManager.getAiTaskManifest).toHaveBeenCalledWith('summarization', 'openai');
      expect(mockComputerManager.compute).toHaveBeenCalledWith(
        mockContext,
        'you are a summarization assistant',
        'summarization',
        'openai',
        expect.any(Object)
      );
      expect(mockOpenAiLlm.prepareGenerateRequest).toHaveBeenCalled();
      expect(mockOpenAiLlm.generate).toHaveBeenCalled();
      expect(mockOpenAiLlm.formatToUnifiedLLMResponse).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should execute AI task with message array content', async () => {
      // Arrange
      const messages = [
        {
          id: 'msg-1',
          role: Type.LLM.UnifiedMessageRole.user,
          content: [{ type: 'text' as const, text: 'Summarize this text' }],
          createdAt: new Date(),
          updatedAt: new Date(),
          sequenceId: '1',
          sessionId: 'test-session-id',
          ctx: {},
          author: 'user',
          llmName: 'openai',
          manifestName: 'default',
          llmIgnore: false
        }
      ] as Type.Entity.Message[];

      // Mock getAiTaskManifest to return a valid manifest
      manifestManager.getAiTaskManifest = vi.fn().mockResolvedValue({
        systemMessage: 'you are a summarization assistant',
        modelPreset: { model: 'gpt-4', temperature: 0.3 }
      });

      // Act
      const result = await llmManager.aiTask(mockContext, 'openai', 'summarization', messages);

      // Assert
      expect(manifestManager.getAiTaskManifest).toHaveBeenCalledWith('summarization', 'openai');
      expect(mockComputerManager.compute).toHaveBeenCalledWith(
        mockContext,
        'you are a summarization assistant',
        'summarization',
        'openai',
        expect.any(Object)
      );
      expect(mockOpenAiLlm.prepareGenerateRequest).toHaveBeenCalled();
      expect(mockOpenAiLlm.generate).toHaveBeenCalled();
      expect(mockOpenAiLlm.formatToUnifiedLLMResponse).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should throw error when AI task content is empty', async () => {
      // Arrange
      const emptyMessages: Type.Entity.Message[] = [];

      // Act & Assert
      await expect(llmManager.aiTask(mockContext, 'openai', 'summarization', emptyMessages)).rejects.toThrow(
        'Content must be a string or an array of messages'
      );
    });

    it('should generate queued response', async () => {
      // Arrange
      const callContext = {
        messageIds: ['msg-1']
      } as Type.LLM.CallContext;

      // Act
      await llmManager.generateQueued(mockContext, 'default', callContext);

      // Assert
      expect(mockOpenAiLlm.prepareGenerateRequest).toHaveBeenCalled();
      expect(mockOpenAiLlm.generateQueued).toHaveBeenCalled();
      expect(mockComputerManager.compute).toHaveBeenCalledWith(
        mockContext,
        'you are a helpful assistant',
        'default',
        'openai',
        expect.any(Object)
      );
    });

    it('should generate stream response', async () => {
      // Act
      const stream = await llmManager.generateStream(mockContext, 'default');

      // Assert
      expect(mockOpenAiLlm.prepareGenerateRequest).toHaveBeenCalled();
      expect(mockOpenAiLlm.generateStream).toHaveBeenCalled();
      expect(mockComputerManager.compute).toHaveBeenCalledWith(
        mockContext,
        'you are a helpful assistant',
        'default',
        'openai'
      );
      expect(stream).toBeDefined();
    });

    it('should throw error when LLM strategy does not support generateStream', async () => {
      // Arrange
      // Remove generateStream method
      mockOpenAiLlm.generateStream = undefined;

      // Act & Assert
      await expect(llmManager.generateStream(mockContext, 'default')).rejects.toThrow(
        "The LLM strategy does not support 'generateStream'"
      );
    });

    it('should get prompt from ManifestManager and compute it', async () => {
      // Arrange
      manifestManager.getPrompt = vi.fn().mockResolvedValue({
        name: 'weather-prompt',
        content: 'What is the weather in {location}?'
      });

      mockComputerManager.compute = vi.fn().mockResolvedValue('What is the weather in New York?');

      // Act
      const prompt = await llmManager.getPrompt(mockContext, 'weather-prompt', 'openai');

      // Assert
      expect(manifestManager.getPrompt).toHaveBeenCalledWith('weather-prompt', 'openai');
      expect(mockComputerManager.compute).toHaveBeenCalledWith(
        mockContext,
        'What is the weather in {location}?',
        'weather-prompt',
        'openai'
      );
      expect(prompt).toBe('What is the weather in New York?');
    });

    it('should look up the prompt text for the given prompt and LLM', async () => {
      mockComputerManager.compute = vi.fn().mockImplementation(async (_ctx, content) => content);

      const prompt = await llmManager.getPrompt(mockContext, 'weather-prompt', 'anthropic');

      expect(prompt).toBe('Tell me about the weather in {location}.');
      expect(mockComputerManager.compute).toHaveBeenCalledWith(mockContext, prompt, 'weather-prompt', 'anthropic');
    });

    it('should get health check statuses from all LLM strategies', async () => {
      // Act
      const statuses = await llmManager.getHealthCheckStatuses();

      // Assert
      expect(mockOpenAiLlm.getHealthCheckStatus).toHaveBeenCalled();
      expect(mockAnthropicLlm.getHealthCheckStatus).toHaveBeenCalled();
      expect(statuses).toEqual([true, true]);
    });

    describe('additionalTools', () => {
      it('should merge additional tool definitions with MCP tools in prepareGenerateRequest', async () => {
        // Arrange
        const additionalTools: import('@moc-global/loft-definitions').Chat.AdditionalTool[] = [
          {
            definition: {
              name: 'custom_tool',
              description: 'A custom tool',
              inputSchema: {
                type: Chat.AdditionalToolSchemaType.OBJECT,
                properties: { field: { type: 'string' } }
              }
            },
            handler: vi.fn().mockResolvedValue({ content: [{ type: Chat.AdditionalToolContentType.TEXT, text: 'ok' }] })
          }
        ];

        const messages: Type.Entity.CreateMessage[] = [
          {
            role: Type.LLM.UnifiedMessageRole.user,
            content: [{ type: 'text' as const, text: 'Hello' }],
            sessionId: 'test-session',
            ctx: {},
            author: 'user',
            llmName: 'openai',
            manifestName: 'default',
            llmIgnore: false
          }
        ];

        // Act
        await llmManager.generate(mockContext, 'openai', 'default', messages, additionalTools, 30);

        // Assert — prepareGenerateRequest should receive merged tools array
        expect(mockOpenAiLlm.prepareGenerateRequest).toHaveBeenCalledWith(
          expect.any(Array),
          expect.any(String),
          expect.any(Array),
          expect.any(String),
          expect.any(Object),
          expect.arrayContaining([expect.objectContaining({ name: 'custom_tool' })]),
          expect.any(Number)
        );
      });

      it('should route tool calls to additional tool handler instead of MCP', async () => {
        // Arrange
        const handlerFn = vi.fn().mockResolvedValue({
          content: [{ type: Chat.AdditionalToolContentType.TEXT, text: 'handled by additional tool' }],
          isError: false
        });

        const additionalTools: import('@moc-global/loft-definitions').Chat.AdditionalTool[] = [
          {
            definition: {
              name: 'custom_tool',
              description: 'A custom tool',
              inputSchema: {
                type: Chat.AdditionalToolSchemaType.OBJECT,
                properties: { value: { type: 'string' } }
              }
            },
            handler: handlerFn
          }
        ];

        // Mock LLM to return a tool call on first request, then a normal response on second
        let callCount = 0;
        (mockOpenAiLlm.generate as any).mockImplementation(() => {
          callCount++;
          return Promise.resolve({
            llmBody: { content: callCount === 1 ? 'tool_call' : 'final response' }
          });
        });

        (mockOpenAiLlm.formatToUnifiedLLMResponse as any).mockImplementation(
          (correlatorIds: string[], sessionId: string, _llmBody: any) => {
            if (callCount === 1) {
              // First call: LLM requests a tool
              return Promise.resolve({
                topChoice: {
                  id: 'msg-tool',
                  sessionId,
                  role: Type.LLM.UnifiedMessageRole.assistant,
                  author: 'assistant',
                  content: [
                    {
                      type: 'tool_call',
                      callId: 'call-1',
                      params: { name: 'custom_tool', arguments: { value: 'test' } }
                    }
                  ],
                  ctx: {},
                  llmName: 'openai',
                  manifestName: 'default',
                  sequenceId: '1',
                  llmIgnore: false,
                  createdAt: new Date(),
                  updatedAt: new Date()
                },
                choices: [],
                usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }
              });
            }
            // Second call: normal response
            return Promise.resolve({
              topChoice: {
                id: 'msg-final',
                sessionId,
                role: Type.LLM.UnifiedMessageRole.assistant,
                author: 'assistant',
                content: [{ type: 'text', text: 'final response' }],
                ctx: {},
                llmName: 'openai',
                manifestName: 'default',
                sequenceId: '2',
                llmIgnore: false,
                createdAt: new Date(),
                updatedAt: new Date()
              },
              choices: [],
              usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }
            });
          }
        );

        const messages: Type.Entity.CreateMessage[] = [
          {
            role: Type.LLM.UnifiedMessageRole.user,
            content: [{ type: 'text' as const, text: 'Hello' }],
            sessionId: 'test-session',
            ctx: {},
            author: 'user',
            llmName: 'openai',
            manifestName: 'default',
            llmIgnore: false
          }
        ];

        // Act
        await llmManager.generate(mockContext, 'openai', 'default', messages, additionalTools, 30);

        // Assert — additional tool handler was called, MCP was NOT called
        expect(handlerFn).toHaveBeenCalledWith({ value: 'test' }, { signal: undefined, emit: expect.any(Function) });
        expect(mockMCPManager.callTool).not.toHaveBeenCalled();
      });

      it('should generate without additional tools when none provided', async () => {
        // Arrange
        const messages: Type.Entity.CreateMessage[] = [
          {
            role: Type.LLM.UnifiedMessageRole.user,
            content: [{ type: 'text' as const, text: 'Hello' }],
            sessionId: 'test-session',
            ctx: {},
            author: 'user',
            llmName: 'openai',
            manifestName: 'default',
            llmIgnore: false
          }
        ];

        // Act
        await llmManager.generate(mockContext, 'openai', 'default', messages);

        // Assert — should work normally with MCP tools only (empty list in mock)
        expect(mockOpenAiLlm.prepareGenerateRequest).toHaveBeenCalledWith(
          expect.any(Array),
          expect.any(String),
          expect.any(Array),
          expect.any(String),
          expect.any(Object),
          [], // No tools (empty MCP + no additional)
          expect.any(Number)
        );
      });
    });
  });

  describe('MCP tool errors', () => {
    // Runs one tool call that returns toolResponse and returns the messages of the follow-up LLM request
    async function runToolCallReturning(toolResponse: CallToolResult): Promise<Type.Entity.CreateMessage[]> {
      vi.mocked(mockMCPManager.listTools).mockResolvedValue([
        { name: 'book_table', inputSchema: { type: 'object', properties: {} } }
      ]);
      vi.mocked(mockMCPManager.callTool).mockResolvedValue(toolResponse);
      Object.assign(mockMCPManager, { getClientsInfoForTool: vi.fn().mockResolvedValue(new Map()) });
      // The default interceptor runs the tool
      vi.mocked(mockToolInterceptorManager.handle).mockImplementation(({ toolRequest, executeToolFn }) =>
        executeToolFn({ params: toolRequest.params })
      );
      let call = 0;
      vi.mocked(mockOpenAiLlm.generate).mockImplementation(async () => {
        call++;
        return { llmBody: {} } as Strategy.LLM.LlmResponse<unknown>;
      });
      vi.mocked(mockOpenAiLlm.formatToUnifiedLLMResponse).mockImplementation(
        (_correlatorIds, sessionId) =>
          ({
            topChoice: {
              id: `msg-${call}`,
              sessionId,
              role: Type.LLM.UnifiedMessageRole.assistant,
              author: 'assistant',
              content:
                call === 1
                  ? [{ type: 'tool_call', callId: 'call-1', params: { name: 'book_table', arguments: {} } }]
                  : [{ type: 'text', text: 'Sorry, no table is free at 19:00.' }],
              ctx: {},
              llmName: 'openai',
              manifestName: 'default',
              llmIgnore: false
            },
            choices: [],
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
          }) as unknown as Strategy.LLM.UnifiedLLMResponse
      );
      const messages: Type.Entity.CreateMessage[] = [
        {
          role: Type.LLM.UnifiedMessageRole.user,
          content: [{ type: 'text' as const, text: 'Book a table for 19:00' }],
          sessionId: 'test-session',
          ctx: {},
          author: 'user',
          llmName: 'openai',
          manifestName: 'default',
          llmIgnore: false
        }
      ];

      await llmManager.generate(mockContext, 'openai', 'default', messages, undefined, 30);

      return vi.mocked(mockOpenAiLlm.prepareGenerateRequest).mock.calls[1][2];
    }

    it("sends the tool's error text to the LLM in the next request", async () => {
      const errorContent = [{ type: 'text' as const, text: 'No table free at 19:00' }];

      const secondRequestMessages = await runToolCallReturning({ isError: true, content: errorContent });

      expect(secondRequestMessages).toContainEqual(
        expect.objectContaining({
          role: Type.LLM.UnifiedMessageRole.tool,
          content: [{ type: 'tool_result', callId: 'call-1', content: errorContent, isError: true }]
        })
      );
    });

    it.each([
      { error: 'Connection refused', expected: 'Error: Connection refused' },
      { error: { code: 42, reason: 'quota' }, expected: 'Error: {"code":42,"reason":"quota"}' },
      { error: new Error('Timed out'), expected: 'Error: Timed out' },
      { error: undefined, expected: 'Error: Unknown error occurred while executing the tool' }
    ])('describes an error of $error without content as "$expected"', async ({ error, expected }) => {
      const secondRequestMessages = await runToolCallReturning({ isError: true, content: [], error });

      expect(secondRequestMessages).toContainEqual(
        expect.objectContaining({
          role: Type.LLM.UnifiedMessageRole.tool,
          content: [
            { type: 'tool_result', callId: 'call-1', content: [{ type: 'text', text: expected }], isError: true }
          ]
        })
      );
    });
  });

  describe('stop', () => {
    it('stops every registered LLM strategy and skips one without stop()', () => {
      const stop = vi.fn();
      Object.assign(mockOpenAiLlm, { stop });

      llmManager.stop();

      expect(stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('callOptions', () => {
    const messages: Type.Entity.CreateMessage[] = [
      {
        role: Type.LLM.UnifiedMessageRole.user,
        content: [{ type: 'text' as const, text: 'Hello' }],
        sessionId: 'test-session',
        ctx: {},
        author: 'user',
        llmName: 'openai',
        manifestName: 'default',
        llmIgnore: false
      }
    ];

    it('passes the call options to llmStrategy.generate', async () => {
      const { signal } = new AbortController();

      await llmManager.generate(mockContext, 'openai', 'default', messages, undefined, 30, { signal });

      expect(mockOpenAiLlm.generate).toHaveBeenCalledWith(expect.objectContaining({ priority: 30 }), { signal });
    });

    it('rejects an already-aborted generate before any LLM call', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        llmManager.generate(mockContext, 'openai', 'default', messages, undefined, 30, { signal: controller.signal })
      ).rejects.toMatchObject({ name: 'AbortError' });

      expect(mockOpenAiLlm.generate).not.toHaveBeenCalled();
    });

    it('runs no tool and makes no further LLM call when aborted during an LLM call', async () => {
      const controller = new AbortController();
      const handler = vi.fn().mockResolvedValue({ content: [] });
      const additionalTools: Chat.AdditionalTool[] = [
        {
          definition: {
            name: 'custom_tool',
            description: 'A custom tool',
            inputSchema: { type: Chat.AdditionalToolSchemaType.OBJECT, properties: {} }
          },
          handler
        }
      ];
      vi.mocked(mockOpenAiLlm.generate).mockImplementation(async () => {
        controller.abort();
        return { llmBody: {} } as Strategy.LLM.LlmResponse<unknown>;
      });
      vi.mocked(mockOpenAiLlm.formatToUnifiedLLMResponse).mockImplementation(
        (_correlatorIds, sessionId) =>
          ({
            topChoice: {
              id: 'msg-tool',
              sessionId,
              role: Type.LLM.UnifiedMessageRole.assistant,
              author: 'assistant',
              content: [{ type: 'tool_call', callId: 'call-1', params: { name: 'custom_tool', arguments: {} } }],
              ctx: {},
              llmName: 'openai',
              manifestName: 'default',
              llmIgnore: false
            },
            choices: [],
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
          }) as unknown as Strategy.LLM.UnifiedLLMResponse
      );

      await expect(
        llmManager.generate(mockContext, 'openai', 'default', messages, additionalTools, 30, {
          signal: controller.signal
        })
      ).rejects.toMatchObject({ name: 'AbortError' });

      expect(handler).not.toHaveBeenCalled();
      expect(mockOpenAiLlm.generate).toHaveBeenCalledTimes(1);
    });
  });
});
