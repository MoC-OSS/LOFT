import { ejectMessageIdsFromMessages, Interface, Strategy, Type } from '../../..';

export interface GenerateRequestParameters {
  // already saved in chatHistory Repository, but not generated based on this messages yet
  // pendingChatHistory: Type.Entity.Message[]; // removed because it's not needed anymore
  // augmented context is messages that received from chat.generate() args, but are not saved in chatHistory Repository yet
  augmentedContext: Type.Entity.CreateMessage[];
  // direct-messages is that received from chat.generate() args, but are not saved in chatHistory Repository yet
  directMessages: Type.Entity.CreateMessage[];
  // Request-specific LLM configuration that overrides session settings for a single request
  temporaryRequestConfig?: {
    llmName?: string;
    manifestName?: string;
    llmContextWindow?: number; // number of chatHistory messages to keep in the context window (0 = no cropping)

    [key: string]: unknown;
  };
  // Tags for tracing (useful for A/B testing, experiments, etc.)
  tags?: string[];
}

export interface GenerateRequestParametersWithAll extends GenerateRequestParameters {
  all: Type.Entity.CreateMessage[];
}

export interface RequestContext {
  readonly correlatorIds: string[];
  readonly messageIds: {
    // readonly pendingChatHistory: Type.Entity.Message['id'][];
    readonly augmentedContext: Type.Entity.Message['id'][];
    readonly directMessages: Type.Entity.Message['id'][];
    readonly all: Type.Entity.Message['id'][];
  };
  messages: GenerateRequestParametersWithAll;
}

export interface ContextInterface {
  get request(): RequestContext;
  readonly session: Interface.FacadeEntity.Session;
  readonly chatHistory: Interface.FacadeEntity.ChatHistory;
  readonly tracer: Strategy.Tracer.Tracer;

  generate(llmName: string, systemMessageName: string): Promise<Strategy.LLM.UnifiedLLMResponse>;

  aiTask(
    llmName: string,
    aiTaskName: string,
    content: string | Type.Entity.Message[]
  ): Promise<Strategy.LLM.UnifiedLLMResponse>;

  getPrompt(promptName: string, llmName: string): Promise<string>;
}

export interface ContextProviderInterface {
  get(
    sessionId: string,
    generateRequestParameters?: GenerateRequestParameters,
    correlatorIds?: string[]
  ): Promise<ContextInterface>;
  update(
    context: ContextInterface,
    generateRequestParameters?: GenerateRequestParameters,
    correlatorIds?: string[]
  ): Promise<ContextInterface>;
}

export class Context implements ContextInterface {
  public readonly session: Interface.FacadeEntity.Session;
  public readonly chatHistory: Interface.FacadeEntity.ChatHistory;
  public readonly tracer: Strategy.Tracer.Tracer;
  private readonly llmManager: Interface.LlmManager;
  private _request: RequestContext;

  get request(): RequestContext {
    return this._request;
  }

  set request(request: RequestContext) {
    throw new Error('context.request is read-only');
  }

  constructor(
    session: Interface.FacadeEntity.Session,
    chatHistory: Interface.FacadeEntity.ChatHistory,
    llmManager: Interface.LlmManager,
    tracer: Strategy.Tracer.Tracer,
    generateRequestParameters: GenerateRequestParameters = {
      // removed because it's technically difficult to eject the pendingChatHistory messages
      // from the chatHistory and keep the chatHistory repository simple
      // pendingChatHistory: [],
      augmentedContext: [],
      directMessages: [],
      temporaryRequestConfig: { llmContextWindow: 0 }
    },
    correlatorIds: string[] = []
  ) {
    this.llmManager = llmManager;
    this.session = session;
    this.chatHistory = chatHistory;
    this.tracer = tracer;

    // const pendingIds = ejectMessageIdsFromMessages(requestMessages.pendingChatHistory);
    const augmentedIds = ejectMessageIdsFromMessages(generateRequestParameters.augmentedContext);
    const directIds = ejectMessageIdsFromMessages(generateRequestParameters.directMessages);
    const allIds = [...augmentedIds, ...directIds];

    this._request = {
      correlatorIds: correlatorIds,
      messageIds: {
        augmentedContext: augmentedIds,
        directMessages: directIds,
        all: allIds
      },
      messages: {
        ...generateRequestParameters,
        all: [...generateRequestParameters.augmentedContext, ...generateRequestParameters.directMessages]
      }
    };
  }

  async generate(llmName?: string, manifestName?: string): Promise<Strategy.LLM.UnifiedLLMResponse> {
    // First priority: explicitly passed arguments
    // Second priority: values from temporaryRequestConfig
    // Third priority: values from the session
    const tempConfig = this._request.messages.temporaryRequestConfig || {};
    const llmNameToUse = llmName || (tempConfig.llmName as string) || this.session.currentLlmName;
    const manifestNameToUse = manifestName || (tempConfig.manifestName as string) || this.session.currentManifestName;

    return this.llmManager.generate(
      this,
      llmNameToUse,
      manifestNameToUse,
      [...this.chatHistory.messages, ...this.request.messages.all],
      undefined,
      40
    );
  }

  async getPrompt(promptName: string, llmName: string): Promise<string> {
    return this.llmManager.getPrompt(this, promptName, llmName);
  }

  async aiTask(
    llmName: string,
    manifestName: string,
    content: string | Type.Entity.Message[]
  ): Promise<Strategy.LLM.UnifiedLLMResponse> {
    return this.llmManager.aiTask(this, llmName, manifestName, content, 30);
  }
}
