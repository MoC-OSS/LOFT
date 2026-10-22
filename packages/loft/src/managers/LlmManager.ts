import { randomUUID } from 'node:crypto';

import {
  Chat,
  ContextInterface,
  DI_TYPES,
  InteractiveOutputMessage,
  Interface,
  Logger,
  Schema,
  Strategy,
  Type
} from '@moc-global/loft-definitions';
import { inject, injectable, optional } from 'inversify';

import { ChatConfig } from '../types/config';
import { createToolChainDiagnostic, logToolCallStack, UsedToolMessage } from '../utils/toolValidation';
import { executeTool, unsupportedToolResult } from './toolExecution';

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
    callOptions?: Interface.LlmGenerateOptions
  ): Promise<Strategy.LLM.UnifiedLLMResponse> {
    this.log.info(`Generating LLM response`, { llmName, manifestName, sessionId: ctx.session.id, priority });
    // Reports the steps, tools and text of this call to a caller that subscribed to generation events. Strategies
    // never see it, not even as an undefined key.
    const { events, ...strategyCallOptions } = callOptions ?? {};

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

      // This LLM call's step in the caller's events; without events it is not used
      const step = events?.stepStart() ?? 0;
      // With events the provider gets only the signal and this step's sink, never the events object
      const providerOptions = events
        ? { signal: callOptions?.signal, onEvent: events.provider(step) }
        : callOptions && strategyCallOptions;

      let response;
      let generateStartTime: Date;
      try {
        // Capture generation start time right before LLM call
        generateStartTime = new Date();
        response = await llmStrategy.generate(request, providerOptions);
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
      events?.stepText(step, textOf(unifiedLlmResponse.topChoice));
      // The step's own response; the loop limit and a tool interceptor replace unifiedLlmResponse
      const stepResponse = unifiedLlmResponse;
      const finishStep = (hadToolCalls: boolean): void =>
        events?.stepFinish(step, {
          finishReason: stepResponse.usage.finishReason ?? 'unknown',
          hadToolCalls,
          usage: withoutStartTime(stepResponse.usage)
        });

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
        // When the provider streamed, the first output; otherwise the request start
        completionStartTime: events?.firstOutputAt(step) ?? generateStartTime,
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
        finishStep(false);
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
            finishReason: Strategy.LLM.LoftFinishReason.MAX_LOOPS_EXCEEDED
          },
          originalResponse: {
            limitExceeded: true,
            maxCount: MAX_LOOP_COUNT,
            requestedCount: loopCount
          }
        };

        events?.loopLimitReached();
        finishStep(true);
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
          const errorToolResult = unsupportedToolResult({ ctx, request: toolRequest, llmName, manifestName });
          tmpToolsAndResultsChain.push(errorToolResult);
          // The caller sees 'unknown', never the name or arguments the model made up
          events?.toolCall(step, { toolCallId: toolRequest.callId, name: UNKNOWN_TOOL_NAME, args: {} });
          events?.toolResult(step, {
            toolCallId: toolRequest.callId,
            name: UNKNOWN_TOOL_NAME,
            status: 'failed',
            durationMs: 0
          });
          this.log.info(`Added error tool result for unsupported tool "${toolRequest.params.name}"`, {
            callId: toolRequest.callId,
            toolName: toolRequest.params.name,
            chainLength: tmpToolsAndResultsChain.length
          });
        }
      }

      // If all tools were invalid, let the loop re-run so the LLM can produce a text reply
      // given the error tool_results already pushed to tmpToolsAndResultsChain
      if (validPendingTools.length === 0) {
        this.log.info('No valid tools to execute, letting LLM respond to tool errors');
      }

      // Process multiple pending tools with detailed logging
      this.log.info(`Processing ${validPendingTools.length} pending tools`);
      for (const toolRequest of validPendingTools) {
        // A cancelled generate() runs no further tools
        callOptions?.signal?.throwIfAborted();

        const toolName = toolRequest.params.name;
        const handler = additionalToolHandlers.get(toolName);
        const toolCallId = toolRequest.callId;
        events?.toolCall(step, { toolCallId, name: toolName, args: toolRequest.params.arguments ?? {} });
        const toolStartedAt = Date.now();
        const outcome = await executeTool(
          {
            ctx,
            request: toolRequest,
            source: additionalToolHandlers.has(toolName) ? 'additional' : 'mcp',
            handler,
            calledTool: handler ? undefined : mcpTools.find((tool) => tool.name === toolName),
            toolChain: tmpToolsAndResultsChain,
            loop: { current: loopCount, max: MAX_LOOP_COUNT },
            tracer: tracerForGeneration,
            parentGenerationId: generation.id,
            llmName,
            manifestName,
            signal: callOptions?.signal,
            emit: events ? (name, data) => events.data(step, { toolCallId, toolName }, name, data) : undefined
          },
          { mcpManager: this.mcpManager, toolInterceptorManager: this.toolInterceptorManager, log: this.log }
        );
        events?.toolResult(step, {
          toolCallId,
          name: toolName,
          status: outcome.isError ? 'failed' : 'succeeded',
          durationMs: Date.now() - toolStartedAt
        });

        // Check if generation was prevented by tool interceptor (after processing tool result)
        if (outcome.kind === 'override') {
          this.log.info('Tool interceptor prevented LLM generation, using override response');
          events?.markSynthetic();

          // Create override message
          const {
            content,
            role = Type.LLM.UnifiedMessageRole.assistant,
            llmName: payloadLlmName = llmName,
            manifestName: payloadManifestName = manifestName
          } = outcome.override;

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
              finishReason: Strategy.LLM.LoftFinishReason.INTERCEPTOR_OVERRIDE
            },
            originalResponse: { generatedByToolInterceptor: true }
          };

          // Exit the tool execution loop
          shouldCallLLM = false;
          break;
        }
      }
      finishStep(true);
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

  /**
   * @deprecated Use chat.generate({ onEvent }) instead.
   * Removed in the next major release.
   */
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

// The tool name generation events report for a tool call no tool source supports
const UNKNOWN_TOOL_NAME = 'unknown';

// The text parts of a message, joined
function textOf(message: Interface.FacadeEntity.InteractiveOutputMessage): string {
  return message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

// The step's usage as the event sink takes it: without the start time, which is a Date
function withoutStartTime({
  generateStartTime: _startTime,
  ...usage
}: Strategy.LLM.UnifiedUsage): Strategy.LLM.StreamUsage {
  return usage;
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
