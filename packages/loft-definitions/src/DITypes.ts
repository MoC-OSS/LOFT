export const DI_TYPES = {
  BaseLoft: Symbol.for('BaseLoft'),
  /** @experimental Reserved and unused. Nothing is bound to this symbol; streaming a reply is done with `chat.generate({ onEvent })`. */
  StreamLoft: Symbol.for('StreamLoft'),
  /** @experimental Part of the Queued execution mode, which is not implemented yet. May change or be removed in any release. */
  QueuedLoft: Symbol.for('QueuedLoft'),

  /** @experimental Part of the Queued execution mode, which is not implemented yet. May change or be removed in any release. */
  OutgoingQueue: Symbol.for('OutgoingQueue'),

  ManifestManager: Symbol.for('ManifestManager'),
  ManifestRepositoryConfig: Symbol.for('ManifestRepositoryConfig'),
  ManifestRepository: Symbol.for('ManifestRepository'),
  ManifestManagerConfig: Symbol.for('ManifestManagerConfig'),

  LlmManager: Symbol.for('LlmManager'),
  PromptManager: Symbol.for('PromptManager'),
  GMComputerManager: Symbol.for('GMComputerManager'), // GenerateManifestComputerManager
  ATMComputerManager: Symbol.for('ATMComputerManager'), // AiTaskManifestComputerManager
  PromptComputerManager: Symbol.for('PromptComputerManager'),
  ToolInterceptorManager: Symbol.for('ToolInterceptorManager'),
  MCPManager: Symbol.for('MCPManager'),

  ChatConfig: Symbol.for('ChatConfig'),

  SessionRepository: Symbol.for('SessionRepository'),

  ChatHistoryManager: Symbol.for('ChatHistoryManager'),
  ChatHistoryRepository: Symbol.for('ChatHistoryRepository'),
  ChatHistoryPatcherRepository: Symbol.for('ChatHistoryPatcherRepository'),

  ResultCallBack: Symbol.for('ResultCallBack'),
  ErrorHandler: Symbol.for('ErrorHandler'),
  LoftHealthCheck: Symbol.for('LoftHealthCheck'),

  InputMiddleware: Symbol.for('InputMiddleware'),
  BeforeGenerateMiddlewareManager: Symbol.for('BeforeGenerateMiddlewareManager'),
  AfterGenerateMiddlewareManager: Symbol.for('AfterGenerateMiddlewareManager'),

  ContextProvider: Symbol.for('ContextProvider'),
  GenerateResultMessagesProvider: Symbol.for('GenerateResultMessagesProvider'),

  ChatStrategy: Symbol.for('ChatStrategy'),
  LOFT: Symbol.for('LOFT'),

  LlmContextWindowCropper: Symbol.for('LlmContextWindowCropper'),

  TracerStrategy: Symbol.for('TracerStrategy'),

  FocusRegistry: Symbol.for('FocusRegistry')
};
