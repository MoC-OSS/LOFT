// import { ContextInterface, Interface, Logger, Type } from '@moc-global/loft-definitions';
// import { beforeEach, describe, expect, it, vi } from 'vitest';

// import { LlmManager } from '../..';

// describe('LlmManager', () => {
//   let llmManager: LlmManager;
//   let manifestManager: Interface.ManifestManager;
//   let generateManifestComputerManager: Interface.ComputerManager<ContextInterface>;
//   let aiTaskManifestComputerManager: Interface.ComputerManager<ContextInterface>;
//   let promptComputerManager: Interface.ComputerManager<ContextInterface>;
//   let log: Logger;
//   let mcpManager: Interface.MCP.MCPManager;

//   beforeEach(() => {
//     manifestManager = {
//       useLlmManifestSchema: vi.fn(),
//       getLlmManifest: vi.fn().mockResolvedValue({
//         systemMessage: 'testSystemMessage',
//         modelPreset: 'testModelPreset'
//       }),
//       getPrompt: vi.fn().mockResolvedValue({ content: 'testPromptContent', name: 'testPromptName' })
//     } as unknown as Interface.ManifestManager;

//     // Create mock MCP manager
//     mcpManager = {
//       callTool: vi.fn().mockResolvedValue({
//         isError: false,
//         content: [{ result: 'success' }]
//       }),
//       useClient: vi.fn(),
//       listsOfTools: vi.fn().mockResolvedValue([]),
//       listTools: vi.fn().mockResolvedValue([])
//     } as unknown as Interface.MCP.MCPManager;

//     generateManifestComputerManager = {
//       compute: vi.fn().mockResolvedValue('computedSystemMessage')
//     } as unknown as Interface.ComputerManager<ContextInterface>;

//     aiTaskManifestComputerManager = {} as Interface.ComputerManager<ContextInterface>;

//     promptComputerManager = {
//       compute: vi.fn().mockResolvedValue('computedPrompt')
//     } as unknown as Interface.ComputerManager<ContextInterface>;

//     log = {
//       trace: vi.fn(),
//       debug: vi.fn(),
//       info: vi.fn(),
//       warn: vi.fn(),
//       error: vi.fn()
//     } as unknown as Logger;

//     llmManager = new LlmManager(
//       manifestManager,
//       generateManifestComputerManager,
//       aiTaskManifestComputerManager,
//       promptComputerManager,
//       mcpManager,
//       log
//     );
//   });

//   it('should register an LLM strategy', () => {
//     const llmStrategy = {
//       generateModelPresetSchema: () => ({ key: 'value' })
//     } as unknown as Type.LLM.LoftLLM;

//     llmManager.use('testLlm', llmStrategy, false);

//     expect(manifestManager.useLlmManifestSchema).toHaveBeenCalledWith('testLlm', { key: 'value' });
//     expect(log.trace).toHaveBeenCalledWith('Registering LLM Strategy: testLlm');
//   });

//   it('should throw an error when registering a duplicate LLM strategy', () => {
//     const llmStrategy = {
//       generateModelPresetSchema: () => ({ key: 'value' })
//     } as unknown as Type.LLM.LoftLLM;

//     llmManager.use('testLlm', llmStrategy, false);
//     expect(() => llmManager.use('testLlm', llmStrategy, false)).toThrowError(
//       'An Llm Strategy with the name "testLlm" already exists.'
//     );
//   });

//   it('should get an LLM strategy', () => {
//     const llmStrategy = {
//       generateModelPresetSchema: () => ({ key: 'value' })
//     } as unknown as Type.LLM.LoftLLM;

//     llmManager.use('testLlm', llmStrategy, false);

//     const llm = llmManager.get('testLlm');

//     expect(llm).toBe(llmStrategy);
//   });

//   it('should throw an error when getting a non-existent LLM strategy', () => {
//     expect(() => llmManager.get('nonExistentLlm')).toThrowError(
//       'An Llm Strategy with the name "nonExistentLlm" does not exists.'
//     );
//   });

//   it('should throw an error if LLM manifest retrieval fails', async () => {
//     const llmStrategy = {
//       generateModelPresetSchema: vi.fn().mockResolvedValue({ key: 'value' }),
//       prepareGenerateRequest: vi.fn(),
//       generate: vi.fn(),
//       executeMiddlewareChain: vi.fn(),
//       formatToUnifiedLLMResponse: vi.fn()
//     } as unknown as Type.LLM.LoftLLM;

//     llmManager.use('testLlm', llmStrategy, false);

//     manifestManager.getLlmManifest = vi.fn().mockRejectedValue(new Error('Manifest retrieval failed'));

//     const ctx = {
//       session: { id: 'testSessionId', currentLlmName: 'testLlm' },
//       chatHistory: { messages: [] }
//     } as unknown as ContextInterface;

//     await expect(llmManager.generate(ctx, 'testLlm', 'testManifest')).rejects.toThrowError('Manifest retrieval failed');
//   });

//   it('should throw an error if no LLM strategy is found', async () => {
//     const ctx = {
//       session: { id: 'testSessionId', currentLlmName: 'nonExistentLlm' },
//       chatHistory: { messages: [] }
//     } as unknown as ContextInterface;

//     await expect(llmManager.generate(ctx, 'testManifest')).rejects.toThrowError(
//       'An Llm Strategy with the name "nonExistentLlm" does not exists.'
//     );
//   });

//   it('should generate a response using the LLM strategy', async () => {
//     const llmStrategy = {
//       generateModelPresetSchema: vi.fn().mockResolvedValue({ key: 'value' }),
//       prepareGenerateRequest: vi.fn().mockResolvedValue('request'),
//       generate: vi.fn().mockResolvedValue('response'),
//       executeMiddlewareChain: vi.fn().mockResolvedValue({ llmBody: 'processedResponse' }),
//       formatToUnifiedLLMResponse: vi.fn().mockResolvedValue('unifiedResponse')
//     } as unknown as Type.LLM.LoftLLM;

//     llmManager.use('testLlm', llmStrategy);

//     const ctx = {
//       session: { id: 'testSessionId', currentLlmName: 'testLlm' },
//       chatHistory: { messages: [] }
//     } as unknown as ContextInterface;

//     const response = await llmManager.generate(ctx, 'testManifest');

//     expect(response).toBe('unifiedResponse');
//     expect(llmStrategy.prepareGenerateRequest).toHaveBeenCalled();
//     expect(llmStrategy.prepareGenerateRequest).toHaveBeenCalledWith(
//       [],
//       'testSessionId',
//       [],
//       'computedSystemMessage',
//       'testModelPreset',
//       30
//     );
//     expect(llmStrategy.generate).toHaveBeenCalled();
//     expect(llmStrategy.generate).toHaveBeenCalledWith('request');
//     expect(llmStrategy.executeMiddlewareChain).toHaveBeenCalled();
//     expect(llmStrategy.executeMiddlewareChain).toHaveBeenCalledWith(ctx, 'response');
//     expect(llmStrategy.formatToUnifiedLLMResponse).toHaveBeenCalled();
//     expect(llmStrategy.formatToUnifiedLLMResponse).toHaveBeenCalledWith(
//       'testSessionId',
//       'processedResponse',
//       'testLlm',
//       'testManifest'
//     );
//   });

//   it('should handle empty chat history gracefully', async () => {
//     const llmStrategy = {
//       generateModelPresetSchema: vi.fn().mockResolvedValue({ key: 'value' }),
//       prepareGenerateRequest: vi.fn().mockResolvedValue('request'),
//       generate: vi.fn().mockResolvedValue('response'),
//       executeMiddlewareChain: vi.fn().mockResolvedValue({ llmBody: 'processedResponse' }),
//       formatToUnifiedLLMResponse: vi.fn().mockResolvedValue('unifiedResponse')
//     } as unknown as Type.LLM.LoftLLM;

//     llmManager.use('testLlm', llmStrategy);

//     const ctx = {
//       session: { id: 'testSessionId', currentLlmName: 'testLlm' },
//       chatHistory: { messages: [] }
//     } as unknown as ContextInterface;

//     manifestManager.getLlmManifest = vi.fn().mockResolvedValue({
//       systemMessage: 'testSystemMessage',
//       modelPreset: 'testModelPreset'
//     });

//     generateManifestComputerManager.compute = vi.fn().mockResolvedValue('computedSystemMessage');

//     const response = await llmManager.generate(ctx, 'testManifest');

//     expect(response).toBe('unifiedResponse');
//     expect(llmStrategy.prepareGenerateRequest).toHaveBeenCalledWith(
//       'testSessionId',
//       [],
//       'computedSystemMessage',
//       'testModelPreset',
//       30
//     );
//     expect(llmStrategy.generate).toHaveBeenCalledWith('request');
//     expect(llmStrategy.executeMiddlewareChain).toHaveBeenCalledWith(ctx, 'response');
//     expect(llmStrategy.formatToUnifiedLLMResponse).toHaveBeenCalledWith(
//       'testSessionId',
//       'processedResponse',
//       'testLlm',
//       'testManifest'
//     );
//   });

//   it('should compute and return a prompt', async () => {
//     const ctx = {} as unknown as ContextInterface;

//     const result = await llmManager.getPrompt(ctx, 'testLlm', 'testPrompt');

//     expect(result).toBe('computedPrompt');
//     expect(promptComputerManager.compute).toHaveBeenCalled();
//   });

//   it('should return health check statuses for all LLM strategies', async () => {
//     const llmStrategy = {
//       generateModelPresetSchema: vi.fn().mockResolvedValue({ key: 'value' }),
//       getHealthCheckStatus: vi.fn().mockResolvedValue('healthy')
//     } as unknown as Type.LLM.LoftLLM;

//     llmManager.use('testLlm', llmStrategy);

//     const statuses = await llmManager.getHealthCheckStatuses();

//     expect(statuses).toEqual(['healthy']);
//     expect(llmStrategy.getHealthCheckStatus).toHaveBeenCalled();
//   });

//   it('should perform AI task and return a unified response', async () => {
//     const llmStrategy = {
//       generateModelPresetSchema: vi.fn().mockResolvedValue({ key: 'value' }),
//       prepareGenerateRequest: vi.fn().mockResolvedValue('request'),
//       generate: vi.fn().mockResolvedValue({ llmBody: 'responseBody' }),
//       formatToUnifiedLLMResponse: vi.fn().mockResolvedValue('unifiedResponse')
//     } as unknown as Type.LLM.LoftLLM;

//     llmManager.use('testLlm', llmStrategy);

//     const ctx = {
//       session: { id: 'testSessionId', currentLlmName: 'testLlm' }
//     } as unknown as ContextInterface;

//     manifestManager.getAiTaskManifest = vi.fn().mockResolvedValue({
//       systemMessage: 'testSystemMessage',
//       modelPreset: 'testModelPreset'
//     });

//     aiTaskManifestComputerManager.compute = vi.fn().mockResolvedValue('computedSystemMessage');

//     const response = await llmManager.aiTask(ctx, 'testLlm', 'testManifest', 'testContent');

//     expect(response).toBe('unifiedResponse');
//     expect(llmStrategy.prepareGenerateRequest).toHaveBeenCalledWith(
//       'testSessionId',
//       expect.any(Array),
//       'computedSystemMessage',
//       'testModelPreset',
//       40
//     );
//     expect(llmStrategy.generate).toHaveBeenCalledWith('request');
//     expect(llmStrategy.formatToUnifiedLLMResponse).toHaveBeenCalledWith(
//       'testSessionId',
//       'responseBody',
//       'testLlm',
//       'testManifest'
//     );
//   });

//   it('should throw an error if content is empty', async () => {
//     const ctx = {
//       session: { id: 'testSessionId', currentLlmName: 'testLlm' }
//     } as unknown as ContextInterface;

//     await expect(llmManager.aiTask(ctx, 'testLlm', 'testManifest', '')).rejects.toThrow(
//       'Content must be a string or an array of messages'
//     );
//   });

//   it('should handle array of messages as content', async () => {
//     const llmStrategy = {
//       generateModelPresetSchema: vi.fn().mockResolvedValue({ key: 'value' }),
//       prepareGenerateRequest: vi.fn().mockResolvedValue('request'),
//       generate: vi.fn().mockResolvedValue({ llmBody: 'responseBody' }),
//       formatToUnifiedLLMResponse: vi.fn().mockResolvedValue('unifiedResponse')
//     } as unknown as Type.LLM.LoftLLM;

//     llmManager.use('testLlm', llmStrategy);

//     const ctx = {
//       session: { id: 'testSessionId', currentLlmName: 'testLlm' }
//     } as unknown as ContextInterface;

//     const messages = [
//       {
//         id: 'msg1',
//         correlatorId: 'test-correlator-id',
//         createdAt: new Date(),
//         updatedAt: new Date(),
//         sequenceId: '',
//         ctx: {},
//         sessionId: 'testSessionId',
//         content: 'test message 1',
//         role: Type.LLM.UnifiedMessageRole.user,
//         author: Type.LLM.UnifiedMessageRole.user,
//         llmName: 'testLlm',
//         manifestName: 'testManifest',
//         llmIgnore: false,
//         isLocked: false
//       }
//     ];

//     manifestManager.getAiTaskManifest = vi.fn().mockResolvedValue({
//       systemMessage: 'testSystemMessage',
//       modelPreset: 'testModelPreset'
//     });

//     aiTaskManifestComputerManager.compute = vi.fn().mockResolvedValue('computedSystemMessage');

//     const response = await llmManager.aiTask(ctx, 'testLlm', 'testManifest', messages);

//     expect(response).toBe('unifiedResponse');
//     expect(llmStrategy.prepareGenerateRequest).toHaveBeenCalledWith(
//       'testSessionId',
//       messages,
//       'computedSystemMessage',
//       'testModelPreset',
//       40
//     );
//   });

//   it('should handle the case when middleware chain processing fails', async () => {
//     const llmStrategy = {
//       generateModelPresetSchema: vi.fn().mockResolvedValue({ key: 'value' }),
//       prepareGenerateRequest: vi.fn().mockResolvedValue('request'),
//       generate: vi.fn().mockResolvedValue('response'),
//       executeMiddlewareChain: vi.fn().mockRejectedValue(new Error('Middleware processing failed')),
//       formatToUnifiedLLMResponse: vi.fn()
//     } as unknown as Type.LLM.LoftLLM;

//     llmManager.use('testLlm', llmStrategy);

//     const ctx = {
//       session: { id: 'testSessionId', currentLlmName: 'testLlm' },
//       chatHistory: { messages: [] }
//     } as unknown as ContextInterface;

//     manifestManager.getLlmManifest = vi.fn().mockResolvedValue({
//       systemMessage: 'testSystemMessage',
//       modelPreset: 'testModelPreset'
//     });

//     generateManifestComputerManager.compute = vi.fn().mockResolvedValue('computedSystemMessage');

//     await expect(llmManager.generate(ctx, 'testManifest')).rejects.toThrowError('Middleware processing failed');
//   });

//   it('should handle custom priority for generation request', async () => {
//     const llmStrategy = {
//       generateModelPresetSchema: vi.fn().mockResolvedValue({ key: 'value' }),
//       prepareGenerateRequest: vi.fn().mockResolvedValue('request'),
//       generate: vi.fn().mockResolvedValue('response'),
//       executeMiddlewareChain: vi.fn().mockResolvedValue({ llmBody: 'processedResponse' }),
//       formatToUnifiedLLMResponse: vi.fn().mockResolvedValue('unifiedResponse')
//     } as unknown as Type.LLM.LoftLLM;

//     llmManager.use('testLlm', llmStrategy);

//     const ctx = {
//       session: { id: 'testSessionId', currentLlmName: 'testLlm' },
//       chatHistory: { messages: [] }
//     } as unknown as ContextInterface;

//     manifestManager.getLlmManifest = vi.fn().mockResolvedValue({
//       systemMessage: 'testSystemMessage',
//       modelPreset: 'testModelPreset'
//     });

//     generateManifestComputerManager.compute = vi.fn().mockResolvedValue('computedSystemMessage');

//     const response = await llmManager.generate(ctx, 'testManifest', undefined, 50);

//     expect(response).toBe('unifiedResponse');
//     expect(llmStrategy.prepareGenerateRequest).toHaveBeenCalledWith(
//       'testSessionId',
//       [],
//       'computedSystemMessage',
//       'testModelPreset',
//       50 // Custom priority
//     );
//   });

//   it('should successfully queue a generation request with default LLM name', async () => {
//     const llmStrategy = {
//       generateModelPresetSchema: vi.fn().mockResolvedValue({ key: 'value' }),
//       prepareGenerateRequest: vi.fn().mockResolvedValue({ request: 'testRequest' }),
//       generateQueued: vi.fn().mockResolvedValue(void 0)
//     } as unknown as Type.LLM.LoftLLM;

//     llmManager.use('testLlm', llmStrategy);

//     const ctx = {
//       session: { id: 'testSessionId', currentLlmName: 'testLlm' },
//       chatHistory: { messages: [] }
//     } as unknown as ContextInterface;

//     const callContext = {
//       id: 'testCallContextId'
//     } as unknown as Type.LLM.CallContext;

//     manifestManager.getLlmManifest = vi.fn().mockResolvedValue({
//       systemMessage: 'testSystemMessage',
//       modelPreset: 'testModelPreset'
//     });

//     generateManifestComputerManager.compute = vi.fn().mockResolvedValue('computedSystemMessage');

//     await llmManager.generateQueued(ctx, 'testManifest', callContext);

//     expect(llmStrategy.prepareGenerateRequest).toHaveBeenCalledWith(
//       'testSessionId',
//       [],
//       'computedSystemMessage',
//       'testModelPreset',
//       10 // Default priority
//     );

//     expect(llmStrategy.generateQueued).toHaveBeenCalledWith({
//       request: 'testRequest',
//       callContext
//     });
//   });

//   it('should successfully queue a queued generation request with a temporary LLM name', async () => {
//     const llmStrategy = {
//       generateModelPresetSchema: vi.fn().mockResolvedValue({ key: 'value' }),
//       prepareGenerateRequest: vi.fn().mockResolvedValue({ request: 'testRequest' }),
//       generateQueued: vi.fn().mockResolvedValue(void 0)
//     } as unknown as Type.LLM.LoftLLM;

//     llmManager.use('tempLlm', llmStrategy);

//     const ctx = {
//       session: { id: 'testSessionId', currentLlmName: 'defaultLlm' },
//       chatHistory: { messages: [] }
//     } as unknown as ContextInterface;

//     const callContext = {
//       id: 'testCallContextId'
//     } as unknown as Type.LLM.CallContext;

//     manifestManager.getLlmManifest = vi.fn().mockResolvedValue({
//       systemMessage: 'testSystemMessage',
//       modelPreset: 'testModelPreset'
//     });

//     generateManifestComputerManager.compute = vi.fn().mockResolvedValue('computedSystemMessage');

//     await llmManager.generateQueued(ctx, 'testManifest', callContext, 'tempLlm');

//     expect(llmStrategy.prepareGenerateRequest).toHaveBeenCalledWith(
//       'testSessionId',
//       [],
//       'computedSystemMessage',
//       'testModelPreset',
//       10 // Default priority
//     );

//     expect(llmStrategy.generateQueued).toHaveBeenCalledWith({
//       request: 'testRequest',
//       callContext
//     });
//   });

//   it('should successfully generate a generation request with a temporary LLM name', async () => {
//     const llmStrategy = {
//       generateModelPresetSchema: vi.fn().mockResolvedValue({ key: 'value' }),
//       prepareGenerateRequest: vi.fn().mockResolvedValue({ request: 'testRequest' }),
//       generate: vi.fn().mockResolvedValue('generatedResponse'),
//       executeMiddlewareChain: vi.fn().mockResolvedValue({ llmBody: 'processedResponse' }),
//       formatToUnifiedLLMResponse: vi.fn().mockResolvedValue('unifiedResponse')
//     } as unknown as Type.LLM.LoftLLM;

//     llmManager.use('tempLlm', llmStrategy);

//     const ctx = {
//       session: { id: 'testSessionId', currentLlmName: 'defaultLlm' },
//       chatHistory: { messages: [] }
//     } as unknown as ContextInterface;

//     manifestManager.getLlmManifest = vi.fn().mockResolvedValue({
//       systemMessage: 'testSystemMessage',
//       modelPreset: 'testModelPreset'
//     });

//     generateManifestComputerManager.compute = vi.fn().mockResolvedValue('computedSystemMessage');

//     const response = await llmManager.generate(ctx, 'testManifest', 'tempLlm');

//     expect(llmStrategy.prepareGenerateRequest).toHaveBeenCalledWith(
//       'testSessionId',
//       [],
//       'computedSystemMessage',
//       'testModelPreset',
//       30
//     );

//     expect(llmStrategy.generate).toHaveBeenCalledWith({
//       request: 'testRequest'
//     });

//     expect(response).toEqual('unifiedResponse');
//   });
// });
