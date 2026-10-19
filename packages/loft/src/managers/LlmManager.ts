import { randomUUID } from 'node:crypto';
import { inspect } from 'node:util';

import {
  Chat,
  ContextInterface,
  DI_TYPES,
  InteractiveOutputMessage,
  Interface,
  Logger,
  OverrideGeneratePayload,
  Schema,
  Strategy,
  Type
} from '@moc-global/loft-definitions';
import { inject, injectable, optional } from 'inversify';

import { ChatConfig } from '../types/config';
import { createToolChainDiagnostic, logToolCallStack, UsedToolMessage } from '../utils/toolValidation';

@injectable()
export class LlmManager implements Interface.LlmManager {
  private readonly llmStrategies: Map<string, Type.LLM.LoftLLM> = new Map();
  private readonly log = new Logger('LlmManager');

  constructor(
    @inject(DI_TYPES.ManifestManager) private readonly manifestManager: Interface.ManifestManager,
    @inject(DI_TYPES.GMComputerManager)
    private readonly generateManifestComputerManager: Interface.ComputerManager<ContextInterface>,
    @inject(DI_TYPES.ATMComputerManager)
    private readonly aiTaskManifestComputerManager: Interface.ComputerManager<ContextInterface>,
    @inject(DI_TYPES.PromptComputerManager)
    private readonly promptComputerManager: Interface.ComputerManager<ContextInterface>,
    @inject(DI_TYPES.MCPManager) private readonly mcpManager: Interface.MCP.MCPManager,
    @inject(DI_TYPES.LlmContextWindowCropper)
    private readonly llmContextWindowCropper: Strategy.LlmContextWindowCropper,
    @inject(DI_TYPES.ToolInterceptorManager)
    private readonly toolInterceptorManager: Interface.ToolInterceptorManager,
    @inject(DI_TYPES.ChatConfig) @optional() private readonly chatConfig?: ChatConfig
  ) {}

  async use(llmName: string, llmStrategy: Type.LLM.LoftLLM, forceOverwrite: boolean): Promise<void> {
    this.log.trace(`Registering LLM Strategy: ${llmName}`);
    if (this.llmStrategies.has(llmName)) {
      if (!forceOverwrite) {
        this.log.warn(
          `An LLM Strategy with the name "${llmName}" already exists. Skipping registration. Use forceOverwrite=true to override.`
        );
        return;
      }
      this.log.warn(`Overwriting existing LLM Strategy: ${llmName}`);
    }

    // Add schema and register strategy
    await this.manifestManager.useLlmManifestSchema(llmName, llmStrategy.generateModelPresetSchema());
    this.llmStrategies.set(llmName, llmStrategy);
  }

  get(llmName: string): Type.LLM.LoftLLM {
    const llm = this.llmStrategies.get(llmName);
    if (!llm) {
      throw new Error(`An Llm Strategy with the name "${llmName}" does not exists.`);
    }
    return llm;
  }

  async generate(
    ctx: ContextInterface,
    llmName: string,
    manifestName: string,
    messages: Type.Entity.CreateMessage[],
    additionalTools?: Chat.AdditionalTool[],
    priority = 30,
    callOptions?: Strategy.LLM.CallOptions
  ): Promise<Strategy.LLM.UnifiedLLMResponse> {
    this.log.info(`Generating LLM response`, { llmName, manifestName, sessionId: ctx.session.id, priority });

    const llmStrategy = this.get(llmName);
    this.log.debug(`Using LLM strategy for "${llmName}"`);

    const { systemMessage, modelPreset } = await this.manifestManager.getLlmManifest(manifestName, llmName);
    this.log.debug(`Retrieved manifest for "${manifestName}" with model preset "${llmName}"`);

    const { correlatorIds } = ctx.request;

    this.log.debug(`Computing system message for manifest "${manifestName}"`);
    const computedSystemMessage = await this.generateManifestComputerManager.compute(
      ctx,
      systemMessage,
      manifestName,
      llmName,
      modelPreset
    );
    this.log.debug(`System message computed successfully`);

    this.log.debug(`Retrieving MCP tools list`);
    const mcpTools = await this.mcpManager.listTools();
    this.log.debug(`Retrieved ${mcpTools.length} MCP tools`);

    // Merge additional tool definitions with MCP tools for LLM requests
    const additionalToolDefs = additionalTools?.map((t) => t.definition) ?? [];
    const additionalToolHandlers = new Map(additionalTools?.map((t) => [t.definition.name, t.handler]) ?? []);
    const allTools = [...mcpTools, ...additionalToolDefs];

    this.log.debug(
      `Total tools for LLM: ${allTools.length} (${mcpTools.length} MCP + ${additionalToolDefs.length} additional)`
    );
    this.log.trace('Tools available for LLM', {
      toolNames: allTools.map((tool) => tool.name)
    });

    // one assistant role message can have multiple tool calls in content array
    // one tool role message also can have a multiple tool results in content array, but most of LLM expect only one tool result per one tool message
    const tmpToolsAndResultsChain: Array<
      Interface.FacadeEntity.InteractiveOutputMessage & {
        role: Type.LLM.UnifiedMessageRole.assistant | Type.LLM.UnifiedMessageRole.tool;
      }
    > = [];

    // Starting the tools execution loop
    let shouldCallLLM = true;
    let unifiedLlmResponse: Strategy.LLM.UnifiedLLMResponse;
    let loopCount = 0;
    const MAX_LOOP_COUNT =
      this.chatConfig?.mcp?.maxCallsPerGenerate ??
      Number.parseInt(process.env.LOFT_MCP_MAX_CALLS_PER_GENERATE ?? '10', 10);
    let parentGeneration: any = null; // Track parent for nested generations

    this.log.info(`Starting tool execution loop`);
    while (shouldCallLLM) {
      // A cancelled generate() makes no further LLM call
      callOptions?.signal?.throwIfAborted();

      // Increment loop counter and break if reached max iterations
      loopCount++;
      this.log.debug(`Tool execution loop iteration: ${loopCount}/${MAX_LOOP_COUNT}`);

      // if (loopCount >= MAX_LOOP_COUNT) {
      //   this.log.warn(
      //     `Tool execution loop reached maximum iterations (${MAX_LOOP_COUNT}). Breaking loop to prevent infinite execution.`
      //   );
      //   break;
      // }

      // check if the last message in the tool chain has role 'tool' - this is an important sequence requirement for llm
      const isTmpEmpty = tmpToolsAndResultsChain.length === 0;
      const isLastMessageHasToolRole =
        !isTmpEmpty && tmpToolsAndResultsChain.at(-1)?.role === Schema.LLM.UnifiedMessageRole.tool;
      if (!isTmpEmpty && !isLastMessageHasToolRole) {
        throw new Error('The last message in the tool chain must have role "tool"');
      }

      this.log.debug(`Adding ${tmpToolsAndResultsChain.length} tool calls/results to LLM context window`);

      // Validate tool chain consistency before sending to LLM
      const toolChainDiagnostic = createToolChainDiagnostic(tmpToolsAndResultsChain as UsedToolMessage[]);
      if (!toolChainDiagnostic.isValid) {
        this.log.error('Tool chain validation failed before LLM request - continuing anyway', {
          loopCount,
          chainLength: tmpToolsAndResultsChain.length,
          diagnostic: toolChainDiagnostic
        });
        logToolCallStack(tmpToolsAndResultsChain as UsedToolMessage[], 'Pre-LLM validation failed');
      } else {
        this.log.debug('Tool chain validation passed', { diagnostic: toolChainDiagnostic });
      }

      let llmContextWindow = [...messages, ...tmpToolsAndResultsChain];

      // Apply context window cropping
      const targetContextWindow = ctx.request.messages.temporaryRequestConfig?.llmContextWindow ?? 0;
      this.log.debug(`Applying context window cropping with target size: ${targetContextWindow}`);
      const originalLength = llmContextWindow.length;
      llmContextWindow = this.llmContextWindowCropper.crop(llmContextWindow as any, targetContextWindow);
      this.log.debug(`Messages after cropping: ${llmContextWindow.length} (from ${originalLength})`);

      this.log.debug(`Preparing LLM request with context window containing ${llmContextWindow.length} messages`);

      const request = await llmStrategy.prepareGenerateRequest(
        correlatorIds,
        ctx.session.id,
        llmContextWindow,
        computedSystemMessage,
        modelPreset,
        allTools,
        priority
      );

      // Set relevant llmName and manifestName for augmented context
      ctx.request.messages.augmentedContext.forEach((message) => {
        message.llmName = llmName;
        message.manifestName = manifestName;
      });

      // Set relevant llmName and manifestName for direct messages
      ctx.request.messages.directMessages.forEach((message) => {
        message.llmName = llmName;
        message.manifestName = manifestName;
      });

      this.log.info(`Sending request to LLM "${llmName}"`);

      // For subsequent iterations, create wrapped tracer with parent generation
      const tracerForGeneration = parentGeneration ? ctx.tracer.withParent(parentGeneration.id) : ctx.tracer;

      const generation = (tracerForGeneration as any).generation({
        name: `${manifestName}/${llmName}:${modelPreset.model}#${loopCount}`,
        model: modelPreset.model,
        modelParameters: modelPreset,
        input:
          loopCount === 1
            ? {
                directMessages: ctx.request.messages.directMessages,
                augmentedContext: ctx.request.messages.augmentedContext,
                contextWindow: llmContextWindow
              }
            : llmContextWindow,
        metadata: {
          llmName,
          manifestName,
          correlatorIds,
          priority,
          contextWindowLength: llmContextWindow.length,
          mcpToolsCount: mcpTools.length,
          loopIteration: loopCount
        }
      });

      let response;
      let generateStartTime: Date;
      try {
        // Capture generation start time right before LLM call
        generateStartTime = new Date();
        response = await llmStrategy.generate(request, callOptions);
        this.log.debug(`Received response from LLM`);
      } catch (error) {
        // End LLM generation tracing with error
        generation.end({
          level: 'ERROR',
          statusMessage: error instanceof Error ? error.message : String(error)
        });

        this.log.debug(`LLM request failed with error: ${error}`);
        throw error;
      }

      unifiedLlmResponse = await llmStrategy.formatToUnifiedLLMResponse(
        correlatorIds,
        ctx.session.id,
        response.llmBody,
        llmName,
        manifestName
      );

      // End LLM generation tracing with success (after creating unified response)
      generation.end({
        output: unifiedLlmResponse.topChoice,
        usage: {
          promptTokens: unifiedLlmResponse.usage.inputTokens,
          completionTokens: unifiedLlmResponse.usage.outputTokens,
          totalTokens: unifiedLlmResponse.usage.totalTokens
        },
        metadata: {
          model: unifiedLlmResponse.usage.model,
          finishReason: unifiedLlmResponse.usage.finishReason,
          cacheTokens: unifiedLlmResponse.usage.cacheTokens,
          reasoningTokens: unifiedLlmResponse.usage.reasoningTokens,
          totalCost: unifiedLlmResponse.usage.totalCost,
          providerResponse: unifiedLlmResponse.originalResponse
        },
        completionStartTime: generateStartTime,
        level: 'DEFAULT'
      });

      // Set this generation as parent for next iteration
      parentGeneration = generation;

      // Use topChoice directly as InteractiveOutputMessage
      const assistantMessage = unifiedLlmResponse.topChoice;

      const incomingToolsRequest = unifiedLlmResponse.topChoice.content.filter(isToolCallContent);
      this.log.debug(`LLM requested ${incomingToolsRequest.length} tools`);
      this.log.trace('LLM response tool calls', {
        toolCallDetails: incomingToolsRequest.map((tc) => ({
          callId: tc.callId,
          toolName: tc.params?.name
        }))
      });

      if (incomingToolsRequest.length === 0) {
        this.log.debug(`No tools requested by LLM, breaking tool execution loop`);
        break;
      }

      // Check if the LLM iteration limit has been reached.
      // loopCount counts LLM calls, not individual tool requests — comparing against
      // incomingToolsRequest.length would conflate two different units and cap too early.
      if (loopCount >= MAX_LOOP_COUNT) {
        this.log.warn(
          `Tool call limit reached: ${loopCount} >= ${MAX_LOOP_COUNT}. Creating system message about limit exceeded.`
        );

        // Add the assistant message with tool calls but mark as llmIgnore: true
        const ignoredAssistantMessage = new InteractiveOutputMessage({
          sessionId: ctx.session.id,
          ctx: {},
          content: unifiedLlmResponse.topChoice.content, // Contains the tool_calls
          role: Schema.LLM.UnifiedMessageRole.assistant,
          author: unifiedLlmResponse.topChoice.author,
          llmIgnore: true, // Don't send this to LLM
          llmName: llmName,
          manifestName: manifestName
        });

        tmpToolsAndResultsChain.push(ignoredAssistantMessage as any);

        // Create system message about limit exceeded
        const limitExceededMessage = new InteractiveOutputMessage({
          sessionId: ctx.session.id,
          ctx: {},
          content: [
            {
              type: 'text',
              text: `Too many sequential mcp tool calls — execution chain limit reached.`
            }
          ],
          role: Schema.LLM.UnifiedMessageRole.system,
          author: 'loft-mcp-tools-sequential-calls-limit-reached',
          llmIgnore: false,
          llmName: '',
          manifestName: manifestName
        });

        // Replace the unified response with our limit message, maintaining proper structure
        unifiedLlmResponse = {
          choices: [limitExceededMessage],
          topChoice: limitExceededMessage,
          usedTools: tmpToolsAndResultsChain,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            model: 'limit-exceeded',
            finishReason: 'max_loops_exceeded'
          },
          originalResponse: {
            limitExceeded: true,
            maxCount: MAX_LOOP_COUNT,
            requestedCount: loopCount
          }
        };

        // Exit the loop
        break;
      }

      // Split pending tools into additional tools (handled locally) and MCP tools
      const additionalPendingTools = incomingToolsRequest.filter((t) => additionalToolHandlers.has(t.params.name));
      const mcpPendingTools = incomingToolsRequest.filter((t) => !additionalToolHandlers.has(t.params.name));

      // Reuse mcpTools fetched before the loop — keeps the available-tool set consistent
      // with what the LLM was told existed, and avoids a redundant round-trip per iteration.
      const availableToolNames = new Set(mcpTools.map((tool) => tool.name));

      // Filter MCP tools that are actually available
      const validMcpTools = mcpPendingTools.filter((toolRequest) => {
        const isToolAvailable = availableToolNames.has(toolRequest.params.name);
        if (!isToolAvailable) {
          this.log.warn(`Tool "${toolRequest.params.name}" is not available in any MCP client or additional tools`);
        }
        return isToolAvailable;
      });

      const validPendingTools = [...additionalPendingTools, ...validMcpTools];
      this.log.info(
        `Found ${validPendingTools.length} valid tools out of ${incomingToolsRequest.length} requested (${additionalPendingTools.length} additional + ${validMcpTools.length} MCP)`
      );

      // Ensure the role is the correct type before pushing
      if (hasToolOrAssistantRole(assistantMessage)) {
        tmpToolsAndResultsChain.push(assistantMessage);
        this.log.debug(`Added assistant message to tool chain`, {
          messageId: assistantMessage.id,
          role: assistantMessage.role,
          toolCallsCount: incomingToolsRequest.length,
          chainLength: tmpToolsAndResultsChain.length
        });
      } else {
        this.log.error(`Assistant message with unexpected role: ${assistantMessage.role}, not adding to chain`, {
          messageId: assistantMessage.id,
          actualRole: assistantMessage.role,
          expectedRoles: ['assistant', 'tool'],
          contentLength: assistantMessage.content?.length || 0,
          author: assistantMessage.author,
          chainLength: tmpToolsAndResultsChain.length,
          loopCount
        });
        // Continue without throwing error - system remains stable
      }

      // Ensure all tool calls have responses, even for unsupported tools
      // This creates a 1:1 mapping between tool calls and tool results
      for (const toolRequest of incomingToolsRequest) {
        // If tool is not in the valid list, create an error response
        if (!validPendingTools.some((valid) => valid.callId === toolRequest.callId)) {
          const errorContent: Type.Entity.ToolResultContent = {
            type: 'tool_result',
            callId: toolRequest.callId,
            content: [
              {
                type: 'text' as const,
                text: `Error: Tool "${toolRequest.params.name}" is not supported by any registered tool source`
              }
            ],
            isError: true
          };

          const errorToolResult = new InteractiveOutputMessage({
            sessionId: ctx.session.id,
            ctx: {},
            content: [errorContent],
            role: Type.LLM.UnifiedMessageRole.tool,
            author: `tool-${toolRequest.params.name}`,
            llmName,
            manifestName,
            llmIgnore: false
          });

          if (hasToolOrAssistantRole(errorToolResult)) {
            tmpToolsAndResultsChain.push(errorToolResult);
            this.log.info(`Added error tool result for unsupported tool "${toolRequest.params.name}"`, {
              callId: toolRequest.callId,
              toolName: toolRequest.params.name,
              chainLength: tmpToolsAndResultsChain.length
            });
          }
        }
      }

      // If all tools were invalid, let the loop re-run so the LLM can produce a text reply
      // given the error tool_results already pushed to tmpToolsAndResultsChain
      if (validPendingTools.length === 0) {
        this.log.info('No valid tools to execute, letting LLM respond to tool errors');
      }

      // Process multiple pending tools with detailed logging
      this.log.info(`Processing ${validPendingTools.length} pending tools`);
      for (const mcpToolRequest of validPendingTools) {
        // A cancelled generate() runs no further tools
        callOptions?.signal?.throwIfAborted();

        this.log.debug(`Executing tool: "${mcpToolRequest.params.name}" with callId: ${mcpToolRequest.callId}`, {
          toolName: mcpToolRequest.params.name,
          callId: mcpToolRequest.callId,
          params: mcpToolRequest.params,
          loopCount,
          chainLength: tmpToolsAndResultsChain.length,
          source: additionalToolHandlers.has(mcpToolRequest.params.name) ? 'additional' : 'mcp'
        });

        // Handle additional tools (non-MCP) with direct handler invocation
        const additionalHandler = additionalToolHandlers.get(mcpToolRequest.params.name);
        if (additionalHandler) {
          const toolSpan = tracerForGeneration.withParent(generation.id).span({
            name: `additional-tool-${mcpToolRequest.params.name}`,
            input: mcpToolRequest.params,
            metadata: {
              toolName: mcpToolRequest.params.name,
              callId: mcpToolRequest.callId,
              loopIteration: loopCount,
              source: 'additional'
            }
          });

          try {
            const result = await additionalHandler(mcpToolRequest.params.arguments ?? {});

            const unifiedToolContent: Type.Entity.ToolResultContent = {
              type: 'tool_result',
              callId: mcpToolRequest.callId,
              content: result.content as Type.Entity.ToolResultContent['content'],
              isError: result.isError ?? false
            };

            const toolResult = new InteractiveOutputMessage({
              sessionId: ctx.session.id,
              ctx: {},
              content: [unifiedToolContent],
              role: Type.LLM.UnifiedMessageRole.tool,
              author: `tool-${mcpToolRequest.params.name}`,
              llmName,
              manifestName,
              llmIgnore: false
            });

            if (hasToolOrAssistantRole(toolResult)) {
              tmpToolsAndResultsChain.push(toolResult);
              this.log.debug(`Added additional tool result to chain`, {
                toolName: mcpToolRequest.params.name,
                callId: mcpToolRequest.callId,
                chainLength: tmpToolsAndResultsChain.length,
                isError: result.isError,
                loopCount
              });
            }

            toolSpan.end({
              output: toolResult,
              metadata: { isError: result.isError ?? false, source: 'additional' },
              level: result.isError ? 'WARNING' : 'DEFAULT'
            });
          } catch (error) {
            this.log.error(`Critical error during additional tool execution: "${mcpToolRequest.params.name}"`, {
              toolName: mcpToolRequest.params.name,
              callId: mcpToolRequest.callId,
              error: error instanceof Error ? error.message : String(error),
              loopCount
            });

            const errorToolContent: Type.Entity.ToolResultContent = {
              type: 'tool_result',
              callId: mcpToolRequest.callId,
              content: [
                {
                  type: 'text',
                  text: `Critical execution error: ${error instanceof Error ? error.message : String(error)}`
                }
              ],
              isError: true
            };

            const errorToolResult = new InteractiveOutputMessage({
              sessionId: ctx.session.id,
              ctx: {},
              content: [errorToolContent],
              role: Type.LLM.UnifiedMessageRole.tool,
              author: `tool-${mcpToolRequest.params.name}`,
              llmName,
              manifestName,
              llmIgnore: false
            });

            if (hasToolOrAssistantRole(errorToolResult)) {
              tmpToolsAndResultsChain.push(errorToolResult);
            }

            toolSpan.end({
              output: errorToolResult,
              metadata: { isError: true, source: 'additional' },
              level: 'ERROR',
              statusMessage: error instanceof Error ? error.message : String(error)
            });
          }

          continue; // Skip MCP execution path
        }

        // MCP tool execution path (existing logic)
        const toolSpan = tracerForGeneration.withParent(generation.id).span({
          name: `mcp-tool-${mcpToolRequest.params.name}`,
          input: mcpToolRequest.params,
          metadata: {
            toolName: mcpToolRequest.params.name,
            callId: mcpToolRequest.callId,
            loopIteration: loopCount
          }
        });

        try {
          // Find the specific tool being called
          const calledTool = mcpTools.find((tool) => tool.name === mcpToolRequest.params.name);

          // Get MCP clients with metadata that support this tool
          const toolClientsMap = await this.mcpManager.getClientsInfoForTool(mcpToolRequest.params.name);

          // Convert Map to Array for toolInterceptor callback
          const toolClients = Array.from(toolClientsMap.entries()).map(([clientName, metadata]) => ({
            clientName,
            metadata
          }));

          // Call interceptor if available, otherwise use default behavior
          let preventGeneration = false;
          let overridePayload: OverrideGeneratePayload | null = null;

          const toolResponse =
            this.toolInterceptorManager && calledTool
              ? await this.toolInterceptorManager.handle({
                  ctx,
                  toolRequest: mcpToolRequest,
                  calledTool,
                  toolChain: tmpToolsAndResultsChain,
                  executeToolFn: ({ params, clientNames }) =>
                    this.mcpManager.callTool(params, undefined, undefined, clientNames),
                  callLimits: {
                    current: loopCount,
                    max: MAX_LOOP_COUNT
                  },
                  toolClients,
                  preventGenerate: (payload: OverrideGeneratePayload) => {
                    preventGeneration = true;
                    overridePayload = payload;
                  }
                })
              : await this.mcpManager.callTool(mcpToolRequest.params);

          this.log.debug(`Tool "${mcpToolRequest.params.name}" execution completed`, {
            toolName: mcpToolRequest.params.name,
            callId: mcpToolRequest.callId,
            isError: toolResponse.isError,
            contentLength: toolResponse.content?.length || 0,
            hasError: !!toolResponse.error
          });

          // Create tool result content
          const unifiedToolContent: Type.Entity.ToolResultContent = {
            type: 'tool_result',
            callId: mcpToolRequest.callId,
            content: toolResponse.content,
            isError: toolResponse.isError
          };

          // If there's an error and no content provided, add a text content item explaining the error
          if (toolResponse.isError && (!toolResponse.content || toolResponse.content.length === 0)) {
            const errorMessage = describeToolError(toolResponse.error);
            unifiedToolContent.content = [
              {
                type: 'text',
                text: `Error: ${errorMessage}`
              }
            ];
            this.log.warn(`Tool "${mcpToolRequest.params.name}" execution failed`, {
              toolName: mcpToolRequest.params.name,
              callId: mcpToolRequest.callId,
              error: errorMessage,
              loopCount
            });
          }

          const toolResult = new InteractiveOutputMessage({
            sessionId: ctx.session.id,
            ctx: {},
            content: [unifiedToolContent], // This is the correct structure according to schema
            role: Type.LLM.UnifiedMessageRole.tool,
            author: `tool-${mcpToolRequest.params.name}`,
            llmName,
            manifestName,
            llmIgnore: false
          });

          // Ensure the role is the correct type before pushing
          if (hasToolOrAssistantRole(toolResult)) {
            tmpToolsAndResultsChain.push(toolResult);
            this.log.debug(`Added tool result to the tools chain`, {
              toolName: mcpToolRequest.params.name,
              callId: mcpToolRequest.callId,
              chainLength: tmpToolsAndResultsChain.length,
              isError: toolResponse.isError,
              loopCount
            });
          } else {
            this.log.error(`Tool result with unexpected role: ${toolResult.role}, not adding to chain`, {
              toolName: mcpToolRequest.params.name,
              callId: mcpToolRequest.callId,
              actualRole: toolResult.role,
              expectedRoles: ['assistant', 'tool'],
              chainLength: tmpToolsAndResultsChain.length,
              loopCount
            });
          }

          // End tool span with success
          toolSpan.end({
            output: toolResult,
            metadata: {
              isError: toolResponse.isError,
              contentLength: toolResponse.content?.length || 0,
              hasContent: !!toolResponse.content
            },
            level: toolResponse.isError ? 'WARNING' : 'DEFAULT'
          });

          // Check if generation was prevented by tool interceptor (after processing tool result)
          if (preventGeneration && overridePayload) {
            this.log.info('Tool interceptor prevented LLM generation, using override response');

            // Create override message
            const {
              content,
              role = Type.LLM.UnifiedMessageRole.assistant,
              llmName: payloadLlmName = llmName,
              manifestName: payloadManifestName = manifestName
            } = overridePayload;

            const overrideMessage = new InteractiveOutputMessage({
              content,
              role,
              author: 'tool_interceptor',
              llmName: payloadLlmName,
              manifestName: payloadManifestName,
              sessionId: ctx.session?.id || '',
              ctx: {},
              llmIgnore: false
            });

            // Replace unifiedLlmResponse with override response
            unifiedLlmResponse = {
              choices: [overrideMessage],
              topChoice: overrideMessage,
              usedTools: tmpToolsAndResultsChain,
              usage: {
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                model: 'tool-interceptor',
                finishReason: 'interceptor_override' // TODO: Add to Unified finish reasons
              },
              originalResponse: { generatedByToolInterceptor: true }
            };

            // Exit the tool execution loop
            shouldCallLLM = false;
            break;
          }
        } catch (error) {
          // Handle tool execution errors gracefully
          this.log.error(`Critical error during tool execution: "${mcpToolRequest.params.name}"`, {
            toolName: mcpToolRequest.params.name,
            callId: mcpToolRequest.callId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            loopCount,
            chainLength: tmpToolsAndResultsChain.length
          });

          // Create error tool result to maintain tool call/response balance
          const errorToolContent: Type.Entity.ToolResultContent = {
            type: 'tool_result',
            callId: mcpToolRequest.callId,
            content: [
              {
                type: 'text',
                text: `Critical execution error: ${error instanceof Error ? error.message : String(error)}`
              }
            ],
            isError: true
          };

          const errorToolResult = new InteractiveOutputMessage({
            sessionId: ctx.session.id,
            ctx: {},
            content: [errorToolContent],
            role: Type.LLM.UnifiedMessageRole.tool,
            author: `tool-${mcpToolRequest.params.name}`,
            llmName,
            manifestName,
            llmIgnore: false
          });

          if (hasToolOrAssistantRole(errorToolResult)) {
            tmpToolsAndResultsChain.push(errorToolResult);
            this.log.debug(`Added error tool result after critical failure`, {
              toolName: mcpToolRequest.params.name,
              callId: mcpToolRequest.callId,
              chainLength: tmpToolsAndResultsChain.length,
              loopCount
            });
          }

          // End tool span with error
          toolSpan.end({
            output: errorToolResult,
            metadata: {
              isError: true,
              errorMessage: error instanceof Error ? error.message : String(error)
            },
            level: 'ERROR',
            statusMessage: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
    this.log.info(`Tool execution loop completed after ${loopCount} iterations`);

    this.log.debug(`Executing middleware chain for LLM response`);
    const processedUnifiedLlmResponse = await llmStrategy.executeMiddlewareChain(
      ctx,
      unifiedLlmResponse!,
      correlatorIds
    );

    // Add used tools to the response
    processedUnifiedLlmResponse.usedTools = tmpToolsAndResultsChain;

    this.log.info(`LLM generation completed successfully`, {
      llmName,
      manifestName,
      usedTools: tmpToolsAndResultsChain.length
    });

    return processedUnifiedLlmResponse;
  }

  async aiTask(
    ctx: ContextInterface,
    llmName: string,
    manifestName: string,
    content: string | Type.Entity.Message[],
    priority = 40
  ): Promise<Strategy.LLM.UnifiedLLMResponse> {
    const { session } = ctx;
    const { id: sessionId } = session;
    let messages: Type.Entity.Message[] = [];

    if (typeof content === 'string') {
      const date = new Date();
      const message: Type.Entity.Message = {
        id: `ai-task-${randomUUID()}`,
        createdAt: date,
        updatedAt: date,
        sequenceId: '',
        sessionId: ctx.session.id,
        content: [{ type: 'text', text: content }],
        ctx: {},
        // The text is the task's input; the system message comes from the manifest. Adapters that send only the
        // manifest's system message (Anthropic) would otherwise drop it and send no message at all.
        role: Type.LLM.UnifiedMessageRole.user,
        author: Type.LLM.UnifiedMessageRole.user,
        llmName,
        manifestName: manifestName,
        llmIgnore: false
      };
      messages = [message];
    } else messages = content;

    if (!content.length) {
      throw new Error('Content must be a string or an array of messages');
    }

    const llmStrategy = this.get(llmName);

    const { systemMessage, modelPreset } = await this.manifestManager.getAiTaskManifest(manifestName, llmName);

    const computedSystemMessage = await this.aiTaskManifestComputerManager.compute(
      ctx,
      systemMessage,
      manifestName,
      llmName,
      modelPreset
    );

    const request = await llmStrategy.prepareGenerateRequest(
      ['AiTaskCorrelatorId-will-be-added-later'],
      sessionId,
      messages,
      computedSystemMessage,
      modelPreset,
      [],
      priority
    );

    const response = await llmStrategy.generate(request);

    const unifiedLlmResponse = await llmStrategy.formatToUnifiedLLMResponse(
      ['AiTaskCorrelatorId-will-be-added-later'],
      sessionId,
      response.llmBody,
      llmName,
      manifestName
    );

    return unifiedLlmResponse;
  }

  async generateQueued(
    ctx: ContextInterface,
    manifestName: string,
    callContext: Type.LLM.CallContext,
    tempLlmName?: string,
    priority = 10
  ): Promise<void> {
    const { session } = ctx;
    const { currentLlmName } = session;
    const { correlatorIds } = ctx.request;

    const llmName = tempLlmName || currentLlmName;
    const llmStrategy = this.get(llmName);

    const { systemMessage, modelPreset } = await this.manifestManager.getLlmManifest(manifestName, llmName);

    const computedSystemMessage = await this.generateManifestComputerManager.compute(
      ctx,
      systemMessage,
      manifestName,
      llmName,
      modelPreset
    );

    const request = await llmStrategy.prepareGenerateRequest(
      correlatorIds,
      ctx.session.id,
      ctx.chatHistory.messages,
      computedSystemMessage,
      modelPreset,
      [],
      priority
    );

    await llmStrategy.generateQueued({
      ...request,
      callContext
    });
  }

  async generateStream(
    ctx: ContextInterface,
    manifestName: string,
    tempLlmName?: string,
    priority = 20
  ): Promise<Strategy.LLM.UnifiedLLMStream> {
    const { chatHistory, session } = ctx;
    const { messages } = chatHistory;
    const { currentLlmName } = session;
    const { correlatorIds } = ctx.request;
    const llmName = tempLlmName || currentLlmName;
    const llmStrategy = this.get(llmName);

    if (!('generateStream' in llmStrategy) || !llmStrategy.generateStream)
      throw new Error(`The LLM strategy does not support 'generateStream'`);
    const { systemMessage, modelPreset } = await this.manifestManager.getLlmManifest(manifestName, llmName);

    const computedSystemMessage = await this.generateManifestComputerManager.compute(
      ctx,
      systemMessage,
      manifestName,
      llmName
    );

    const request = await llmStrategy.prepareGenerateRequest(
      correlatorIds,
      session.id,
      messages,
      computedSystemMessage,
      modelPreset,
      [],
      priority
    );
    request.requestType = Strategy.LLM.LLMRequestType.GENERATE_STREAM;
    request.llmBody.stream = true;

    const llmStream = await llmStrategy.generateStream(request);

    return llmStream;
  }

  async getPrompt(ctx: ContextInterface, promptName: string, llmName: string): Promise<string> {
    const prompt = await this.manifestManager.getPrompt(promptName, llmName);
    const computedPrompt = await this.promptComputerManager.compute(ctx, prompt.content, promptName, llmName);
    return computedPrompt;
  }

  async getHealthCheckStatuses(): Promise<boolean[]> {
    const statuses = await Promise.all(
      Array.from(this.llmStrategies.values()).map(async (llmStrategy) => {
        return llmStrategy.getHealthCheckStatus();
      })
    );
    return statuses;
  }

  stop(): void {
    // Several strategies may share one call manager; stop() is safe to call twice
    for (const llmStrategy of this.llmStrategies.values()) {
      llmStrategy.stop?.();
    }
  }
}

type ToolOrAssistantMessage = Interface.FacadeEntity.InteractiveOutputMessage & {
  role: Type.LLM.UnifiedMessageRole.assistant | Type.LLM.UnifiedMessageRole.tool;
};

// Type predicate function to check if a message has the correct role
function hasToolOrAssistantRole(
  message: Interface.FacadeEntity.InteractiveOutputMessage
): message is ToolOrAssistantMessage {
  return message.role === Type.LLM.UnifiedMessageRole.assistant || message.role === Type.LLM.UnifiedMessageRole.tool;
}

// Type guard for tool_call content
function isToolCallContent(content: Type.Entity.FullContentPart): content is Type.Entity.FullContentPart & {
  type: 'tool_call';
  callId: string;
  params: { name: string; arguments: any };
} {
  return content.type === 'tool_call' && 'callId' in content && 'params' in content;
}

// A tool interceptor or MCP server may report the error as any value, not only a string
function describeToolError(error: unknown): string {
  if (typeof error === 'string' && error.length > 0) return error;
  if (error instanceof Error) return error.message;
  if (error === undefined || error === null || error === '') return 'Unknown error occurred while executing the tool';
  try {
    return JSON.stringify(error);
  } catch {
    // JSON.stringify fails on circular values; inspect still describes them
    return inspect(error, { depth: 2 });
  }
}
