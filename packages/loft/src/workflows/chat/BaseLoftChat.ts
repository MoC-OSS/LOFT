import 'reflect-metadata';

import {
  Agent,
  BeforeGenerateMiddlewareManager,
  Chat,
  ContextInterface,
  ContextProviderInterface,
  DI_TYPES,
  GenerateError,
  GenerateRequestParameters,
  Interface,
  Repository,
  Schema,
  StandardMiddlewareManager,
  Strategy,
  Type
} from '@moc-global/loft-definitions';
import { createContextProxyWithOverrides } from '@moc-global/loft-definitions';
import { inject, injectable, optional } from 'inversify';
import { v4 as uuidv4 } from 'uuid';

import { computeFocusStatus, generateFocusPrompt, generateFocusTools, InMemoryFocusStateStore } from '../../focus';
import { FocusRegistry } from '../../focus/FocusRegistry';
import { HealthCheckComponent, LoftHealthCheckInterface } from '../../LoftHealthCheck';
import { GenerateResultMessagesProviderInterface } from '../../providers/GenerateResultMessagesProvider';
import { ChatConfig } from '../../types';
import { AbstractLoftChat } from './AbstractLoftChat';

@injectable()
export class BaseLoftChat extends AbstractLoftChat implements Chat.ChatInterface {
  constructor(
    @inject(DI_TYPES.SessionRepository) public readonly sessionRepository: Repository.Session,
    @inject(DI_TYPES.ChatHistoryManager) protected readonly chatHistoryManager: Repository.ChatHistoryManager,
    @inject(DI_TYPES.ContextProvider) contextProvider: ContextProviderInterface,
    @inject(DI_TYPES.LlmManager) llmManager: Interface.LlmManager,
    @inject(DI_TYPES.ChatConfig) readonly chatConfig: ChatConfig,
    @inject(DI_TYPES.LoftHealthCheck) private readonly loftHealthCheck: LoftHealthCheckInterface,
    @inject(DI_TYPES.InputMiddleware)
    protected readonly inputMiddlewareManager: StandardMiddlewareManager<ContextInterface, GenerateRequestParameters>,
    @inject(DI_TYPES.BeforeGenerateMiddlewareManager)
    protected readonly beforeGenerateMiddlewareManager: BeforeGenerateMiddlewareManager<
      ContextInterface,
      GenerateRequestParameters
    >,
    @inject(DI_TYPES.AfterGenerateMiddlewareManager)
    protected readonly afterGenerateMiddlewareManager: StandardMiddlewareManager<
      ContextInterface,
      Chat.GenerateResultMessages
    >,
    @inject(DI_TYPES.GenerateResultMessagesProvider)
    private readonly generateResultMessagesProvider: GenerateResultMessagesProviderInterface,
    @inject(DI_TYPES.FocusRegistry) @optional() private readonly focusRegistry?: FocusRegistry
  ) {
    super(sessionRepository, chatHistoryManager, contextProvider, llmManager);

    this.log.info('BaseLoft instantiated');
  }

  async addMessages(sessionId: string, correlatorIds: string[], messages: Type.Entity.CreateMessage[]) {
    const operationId = `addMessages-${sessionId}-${uuidv4()}-${Date.now()}`;

    return this.withOperation(operationId, async () => {
      const ctx = await this.contextProvider.get(sessionId);
      const tracer = (ctx as any).tracer as Strategy.Tracer.Tracer;

      const addMessagesSpan = tracer.span({
        name: 'chat/addMessages',
        input: { sessionId, messagesCount: messages.length, correlatorIds },
        metadata: {
          sessionId,
          messagesCount: messages.length,
          correlatorIds
        }
      });

      try {
        this.log.trace('addMessages() called for session: ', { sessionId, messages });

        // Process messages through middleware
        const { payload: processedPayload } = await this.inputMiddlewareManager.executeChain(
          ctx,
          {
            augmentedContext: [],
            directMessages: messages
          },
          correlatorIds
        );

        // Add processed messages to chat history
        await this.chatHistoryManager.addMessages(sessionId, processedPayload.directMessages);

        addMessagesSpan.end({
          output: { processedCount: processedPayload.directMessages.length },
          level: 'DEFAULT'
        });
      } catch (error) {
        // Not the messages themselves: they hold user content
        this.log.error('addMessages() error:', error, { sessionId, messageCount: messages.length });
        addMessagesSpan.end({
          level: 'ERROR',
          statusMessage: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    });
  }

  /**
   * Generate a response based on the provided session context and messages.
   *
   * @param options - Generate options including sessionId, context, and messages
   * @param options.temporaryLlmName - Optional request-specific LLM name to use for this request only
   * @param options.temporaryManifestName - Optional request-specific manifest name to use for this request only
   *
   * The temporary parameters (temporaryLlmName and temporaryManifestName) override the session's values
   * for the current request only, without modifying the session state. This is useful for one-off requests
   * that need different LLM settings without changing the session configuration.
   *
   * These request-specific values:
   * 1. Are passed through the middleware chain in temporaryRequestConfig
   * 2. Are available to middleware managers for processing
   * 3. Are NOT persisted to storage with the session
   * 4. Affect only the current generate call
   */
  async generate({
    sessionId,
    ctx,
    directMessages = [],
    augmentedContext = [],
    correlatorIds = [],
    temporaryLlmName,
    temporaryManifestName,
    llmContextWindow = 0,
    additionalTools,
    focusAgent,
    signal
  }: Chat.GenerateOptions): Promise<Chat.GenerateResult> {
    const operationId = `generate-${sessionId}-${uuidv4()}-${Date.now()}`;
    return this.withOperation(operationId, async () => {
      signal?.throwIfAborted();
      this.log.trace(`generate(): called for session: `, sessionId);
      if (!ctx) {
        this.log.trace(`context not provided, fetching context by sessionId: `, sessionId);
        ctx = await this.contextProvider.get(sessionId);
        if (!ctx) throw new GenerateError(sessionId, [], [], Chat.Status.ERROR, 'Failed to provide context');
      }

      const tracer = (ctx as any).tracer as Strategy.Tracer.Tracer;
      const generateSpan = tracer.span({
        name: 'chat/generate',
        input: {
          sessionId,
          directMessagesCount: directMessages.length,
          augmentedContextCount: augmentedContext.length,
          temporaryLlmName,
          temporaryManifestName,
          correlatorIds
        },
        metadata: {
          sessionId,
          directMessagesCount: directMessages.length,
          augmentedContextCount: augmentedContext.length,
          temporaryLlmName,
          temporaryManifestName,
          correlatorIds
        }
      });

      // Validate structure first
      const {
        success: successDirectMessages,
        error: parseDirectMessagesError,
        data: parsedDirectMessages
      } = Schema.Entity.CreateMessage.array().safeParse(directMessages);
      if (!successDirectMessages) {
        throw new GenerateError(
          sessionId,
          [],
          [],
          Chat.Status.ERROR,
          'Invalid direct messages',
          parseDirectMessagesError
        );
      }

      const {
        success: successAugmentedContext,
        error: parseAugmentedContextError,
        data: parsedAugmentedContext
      } = Schema.Entity.CreateMessage.array().safeParse(augmentedContext);
      if (!successAugmentedContext) {
        throw new GenerateError(
          sessionId,
          [],
          [],
          Chat.Status.ERROR,
          'Invalid augmented context',
          parseAugmentedContextError
        );
      }

      // Process validated messages through middleware
      const { payload: processedInput } = await this.inputMiddlewareManager.executeChain(
        ctx,
        {
          augmentedContext: parsedAugmentedContext,
          directMessages: parsedDirectMessages
        },
        correlatorIds
      );

      // Create request-specific LLM configuration if temporary parameters are provided
      const generateRequestParameters: GenerateRequestParameters = {
        augmentedContext: processedInput.augmentedContext,
        directMessages: processedInput.directMessages
      };

      // Add request-specific LLM configuration if temporary parameters are provided
      generateRequestParameters.temporaryRequestConfig = {
        llmContextWindow
      };

      if (temporaryLlmName || temporaryManifestName) {
        generateRequestParameters.temporaryRequestConfig.llmName = temporaryLlmName;
        generateRequestParameters.temporaryRequestConfig.manifestName = temporaryManifestName;

        // Log that we're using temporary LLM configuration for this request
        this.log.debug(`Using request-specific LLM configuration:`, {
          sessionId,
          temporaryLlmName,
          temporaryManifestName
        });
      }

      // Resolve effective focusAgent BEFORE contextProvider.update so the focus prompt
      // is included in generateRequestParameters before the context is frozen.
      // ctx.session is already populated at this point so the session fallback is available.
      const effectiveFocusAgent =
        focusAgent !== undefined
          ? focusAgent // explicit per-call (string or null)
          : (ctx.session.focusAgent ?? undefined); // session-level fallback

      // Focus pre-processing: inject prompt into generateRequestParameters and collect tool handlers.
      // Must happen before contextProvider.update() so ctx.request.messages.augmentedContext
      // includes the focus prompt — callAndHandle reads exclusively from ctx, not from the
      // local augmentedContext variable.
      const focusContext = await this.resolveFocusContext(
        effectiveFocusAgent ?? undefined,
        sessionId,
        temporaryLlmName,
        temporaryManifestName
      );
      if (focusContext) {
        generateRequestParameters.augmentedContext = [
          ...generateRequestParameters.augmentedContext,
          focusContext.promptMessage
        ];
        additionalTools = [...(additionalTools || []), ...focusContext.tools];
      }

      ctx = await this.contextProvider.update(ctx, generateRequestParameters, correlatorIds);

      let isChatHistoryHasPendingMessages = false;
      if (ctx.chatHistory.messages.length > 0) {
        const lastMessage = ctx.chatHistory.messages[ctx.chatHistory.messages.length - 1];
        if (lastMessage.role === Type.LLM.UnifiedMessageRole.user) {
          isChatHistoryHasPendingMessages = true;
        }
      }

      // Allow passage when focusAgent is active — the focus prompt itself initiates the
      // data-collection conversation even if the caller supplied no messages.
      if (
        !isChatHistoryHasPendingMessages &&
        directMessages.length === 0 &&
        augmentedContext.length === 0 &&
        !effectiveFocusAgent
      ) {
        throw new GenerateError(
          sessionId,
          ctx.request.correlatorIds,
          ctx.request.messageIds.all,
          Chat.Status.ALREADY_GENERATED,
          `generate(): No pending messages found for session: ${sessionId}. Response by session: ${sessionId} already generated`
        );
      }

      try {
        const outputMessages = await this.callAndHandle(ctx, additionalTools, signal);

        // Update tracer with comprehensive metadata and output
        ctx.tracer.update({
          input: generateRequestParameters,
          output: {
            messages: outputMessages,
            status: Chat.Status.SUCCESS,
            correlatorIds: ctx.request.correlatorIds,
            messageIds: ctx.request.messageIds
          },
          metadata: {
            requestOptions: {
              sessionId,
              directMessages,
              augmentedContext,
              temporaryLlmName,
              temporaryManifestName,
              llmContextWindow
            }
          }
        });

        generateSpan.end({
          output: {
            status: Chat.Status.SUCCESS,
            augmentedContextCount: outputMessages.augmentedContext.length,
            directMessagesCount: outputMessages.directMessages.length,
            correlatorIds: ctx.request.correlatorIds
          },
          level: 'DEFAULT'
        });

        // Focus post-processing: recompute status after LLM may have updated fields via tools
        const focusStatus = await this.computeFocusStatusAfterGenerate(focusContext);

        // A completed Focus hands its values back once, in focusStatus.filled, and then clears them:
        // otherwise the next call would complete again with stale data, and the collected
        // personal data would stay in the store.
        if (focusContext && focusStatus?.ready) {
          try {
            await focusContext.store.clear(focusContext.sessionId, focusContext.config.agentName);
          } catch (clearError) {
            this.log.warn('Failed to clear completed Focus state:', clearError);
          }
        }

        // Auto-deactivate session-level Focus when data collection is complete.
        // Only the session's own Focus counts: a different Focus passed for this call does not end it.
        // Also update ctx.session in-place so any code running after this point in the
        // same generate() call (or a cached ctx) sees the correct focusAgent: null value.
        if (focusStatus?.ready && ctx.session.focusAgent && effectiveFocusAgent === ctx.session.focusAgent) {
          try {
            await this.sessionRepository.updateById(sessionId, { focusAgent: null });
            ctx.session.focusAgent = null;
            this.log.info(`Focus auto-deactivated for session ${sessionId} — all fields collected`);
          } catch (deactivateError) {
            this.log.warn('Failed to auto-deactivate Focus on session:', deactivateError);
          }
        }

        // Always flush tracer before returning response
        await ctx.tracer.flushAsync();

        return {
          ctx: ctx,
          sessionId,
          correlatorIds: ctx.request.correlatorIds,
          messageIds: ctx.request.messageIds,
          status: Chat.Status.SUCCESS,
          messages: outputMessages,
          focusStatus
        };
      } catch (error) {
        generateSpan.end({
          level: 'ERROR',
          statusMessage: error instanceof Error ? error.message : String(error)
        });

        // Flush tracer even on error to ensure traces are sent
        try {
          await ctx.tracer.flushAsync();
        } catch (flushError) {
          this.log.warn('Failed to flush tracer on error:', flushError);
        }
        this.log.error('generate() error:', error, sessionId, ctx.request.correlatorIds);

        if (error instanceof GenerateError) throw error;

        throw new GenerateError(
          sessionId,
          ctx.request.correlatorIds,
          ctx.request.messageIds.all,
          Chat.Status.ERROR,
          error instanceof Error ? error.message : String(error),
          error,
          // Also kept in details, where it was before cause carried it
          error
        );
      }
    });
  }

  protected async callAndHandle(
    ctx: ContextInterface,
    additionalTools?: Chat.AdditionalTool[],
    signal?: AbortSignal
  ): Promise<Chat.GenerateResultMessages> {
    const operationId = `callAndHandle-${ctx.session.id}-${uuidv4()}-${Date.now()}`;
    return this.withOperation(operationId, async () => {
      const { id: sessionId } = ctx.session;

      try {
        this.log.trace('callAndHandle() called for session: ', sessionId, ctx.request.correlatorIds);

        const {
          payload: generateRequestParameters,
          isGenerationPrevented,
          overrideGenerateResponse
        } = await this.beforeGenerateMiddlewareManager.executeChain(
          ctx,
          {
            augmentedContext: ctx.request.messages.augmentedContext,
            directMessages: ctx.request.messages.directMessages,
            temporaryRequestConfig: ctx.request.messages.temporaryRequestConfig // Pass along any request-specific LLM config
          },
          ctx.request.correlatorIds
        );

        ctx = await this.contextProvider.update(ctx, generateRequestParameters);

        let llmResponse: Strategy.LLM.UnifiedLLMResponse;

        if (!isGenerationPrevented) {
          // Get request-specific LLM config if available
          const temporaryRequestConfig = ctx.request.messages.temporaryRequestConfig || {};

          // Use request-specific values if provided, otherwise fallback to session values
          const effectiveLlmName = temporaryRequestConfig.llmName || ctx.session.currentLlmName;
          const effectiveManifestName = temporaryRequestConfig.manifestName || ctx.session.currentManifestName;

          // Create LLM operation span to nest generations under
          const llmOperationSpan = ctx.tracer.span({
            name: `llm-operation/${effectiveManifestName}/${effectiveLlmName}`,
            input: {
              effectiveLlmName,
              effectiveManifestName,
              messagesCount:
                ctx.chatHistory.messages.length +
                ctx.request.messages.augmentedContext.length +
                ctx.request.messages.directMessages.length
            },
            metadata: {
              sessionId,
              effectiveLlmName,
              effectiveManifestName,
              correlatorIds: ctx.request.correlatorIds
            }
          });

          // Create wrapped tracer with LLM operation span as parent
          const wrappedTracer = ctx.tracer.withParent(llmOperationSpan.id);

          // Create proxy context with wrapped tracer for generations to be nested
          const ctxForLlmManager = createContextProxyWithOverrides(ctx, {
            tracer: wrappedTracer
          } as any);

          // //todo: move to llmManager
          // // Set relevant llmName and manifestName for augmented context
          // ctx.request.messages.augmentedContext.forEach((message) => {
          //   message.llmName = effectiveLlmName;
          //   message.manifestName = effectiveManifestName;
          // });

          // // Set relevant llmName and manifestName for direct messages
          // ctx.request.messages.directMessages.forEach((message) => {
          //   message.llmName = effectiveLlmName;
          //   message.manifestName = effectiveManifestName;
          // });

          try {
            // Strip inter-node agent traffic from persisted chat history so that
            // each node sees only the original user/assistant conversation, not the
            // accumulated directMessages and augmentedContext from other nodes in the
            // same orchestrator run.  The CURRENT request's directMessages and
            // augmentedContext are always included — they carry this node's input.
            // Stored Focus prompts are stripped too: each turn injects a fresh one with the current status.
            const AGENT_AUTHORS = new Set(['agent', 'orchestrator', 'focus']);
            const activeHistory = ctx.chatHistory.messages.filter((m) => !AGENT_AUTHORS.has(m.author));
            llmResponse = await this.llmManager.generate(
              ctxForLlmManager,
              effectiveLlmName,
              effectiveManifestName,
              [...activeHistory, ...ctx.request.messages.augmentedContext, ...ctx.request.messages.directMessages],
              additionalTools,
              undefined,
              { signal }
            );

            // End span with success
            llmOperationSpan.end({
              output: {
                status: 'success',
                messagesGenerated: llmResponse.topChoice?.content?.length || 0
              },
              level: 'DEFAULT' as any
            });
          } catch (error) {
            // End span with error
            llmOperationSpan.end({
              level: 'ERROR' as any,
              statusMessage: error instanceof Error ? error.message : String(error)
            });
            throw error;
          }
        } else {
          llmResponse = overrideGenerateResponse;
        }

        const response = this.generateResultMessagesProvider.create(
          ctx.request.messages.directMessages,
          ctx.request.messages.augmentedContext,
          llmResponse,
          sessionId
        );

        const { payload: outputMessages } = await this.afterGenerateMiddlewareManager.executeChain(
          ctx,
          response,
          ctx.request.correlatorIds
        );

        return outputMessages;
      } catch (error) {
        this.log.error('callAndHandle() error:', error, sessionId, ctx.request.correlatorIds);

        if (error instanceof GenerateError) throw error;

        throw new GenerateError(
          sessionId,
          ctx.request.correlatorIds,
          ctx.request.messageIds.all,
          Chat.Status.ERROR,
          error instanceof Error ? error.message : String(error),
          error,
          // Also kept in details, where it was before cause carried it
          error
        );
      }
    });
  }

  public async checkHealth(): Promise<boolean> {
    return this.loftHealthCheck.check([
      HealthCheckComponent.SESSION_REPOSITORY,
      HealthCheckComponent.CHAT_HISTORY_MANAGER,
      HealthCheckComponent.LLM_MANAGER
    ]);
  }

  private _focusStore?: Agent.FocusStateStore;
  private _focusStoreResolved = false;

  private resolveFocusStore(): Agent.FocusStateStore {
    if (!this._focusStoreResolved) {
      this._focusStoreResolved = true;
      if (this.sessionRepository?.focus) {
        this._focusStore = this.sessionRepository.focus;
      } else {
        this.log.warn('Session repository does not provide focus store. Falling back to InMemoryFocusStateStore.');
        this._focusStore = new InMemoryFocusStateStore();
      }
    }
    return this._focusStore!;
  }

  private async resolveFocusContext(
    focusAgent: string | undefined,
    sessionId: string,
    llmName?: string,
    manifestName?: string
  ): Promise<
    | {
        config: Agent.Focus;
        store: Agent.FocusStateStore;
        sessionId: string;
        promptMessage: Type.Entity.CreateMessage;
        tools: Chat.AdditionalTool[];
        originalFields: Agent.FocusField[];
        resolveFields?: Agent.Focus['resolveFields'];
      }
    | undefined
  > {
    if (!focusAgent) return undefined;

    if (!this.focusRegistry) {
      throw new GenerateError(
        sessionId,
        [],
        [],
        Chat.Status.ERROR,
        `Focus "${focusAgent}" requested but no FocusRegistry is available`
      );
    }

    const config = this.focusRegistry.get(focusAgent);
    if (!config) {
      throw new GenerateError(
        sessionId,
        [],
        [],
        Chat.Status.ERROR,
        `Focus "${focusAgent}" is not registered. Call loft.registerFocus("${focusAgent}", config) first.`
      );
    }

    const store = this.resolveFocusStore();
    const stored = await store.getAll(sessionId, config.agentName);

    const effectiveFields = config.resolveFields
      ? config.resolveFields({ fields: config.fields, filled: stored })
      : config.fields;
    const effectiveConfig = { ...config, fields: effectiveFields };

    const status = computeFocusStatus(effectiveConfig, stored);
    const focusPrompt = generateFocusPrompt(effectiveConfig, status);

    const promptMessage: Type.Entity.CreateMessage = {
      sessionId,
      content: [{ type: 'text', text: focusPrompt }],
      role: Type.LLM.UnifiedMessageRole.system,
      author: 'focus',
      llmName: llmName || '',
      manifestName: manifestName || '',
      llmIgnore: false,
      ctx: {}
    };

    const tools = generateFocusTools(effectiveConfig, store, sessionId);

    return {
      config: effectiveConfig,
      store,
      sessionId,
      promptMessage,
      tools,
      originalFields: config.fields,
      resolveFields: config.resolveFields
    };
  }

  private async computeFocusStatusAfterGenerate(
    focusContext:
      | {
          config: Agent.Focus;
          store: Agent.FocusStateStore;
          sessionId: string;
          originalFields: Agent.FocusField[];
          resolveFields?: Agent.Focus['resolveFields'];
        }
      | undefined
  ): Promise<Agent.FocusStatus | undefined> {
    if (!focusContext) return undefined;

    const stored = await focusContext.store.getAll(focusContext.sessionId, focusContext.config.agentName);

    const effectiveFields = focusContext.resolveFields
      ? focusContext.resolveFields({ fields: focusContext.originalFields, filled: stored })
      : focusContext.config.fields;

    return computeFocusStatus({ ...focusContext.config, fields: effectiveFields }, stored);
  }
}
