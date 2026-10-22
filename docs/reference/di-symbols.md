# DI Symbols Reference

All injectable services in LOFT are identified by symbols defined in `DI_TYPES`, exported from `@moc-global/loft-definitions`. This page documents every symbol, what it binds to, and which constructor creates the binding.

## Symbol Table

### Core

| Symbol | Bound To | Scope | Bound By |
|--------|----------|-------|----------|
| `DI_TYPES.LOFT` | `LOFT` class | Transient | `LoftConstructor` |
| `DI_TYPES.ChatStrategy` | `BaseLoftChat` | Singleton in chat container, then re-bound as constant value in main container | `ChatConstructor` (singleton binding) + `LoftConstructor` (re-binds via `getInstance()`) |
| `DI_TYPES.ChatConfig` | `ChatConfig` object | Constant value | `ChatConstructor` |
| `DI_TYPES.FocusRegistry` | `FocusRegistry` instance (the Focus configs added with `loft.registerFocus()`) | Constant value | `LoftConstructor` |

### Managers

| Symbol | Bound To | Scope | Bound By |
|--------|----------|-------|----------|
| `DI_TYPES.LlmManager` | `LlmManager` class | Singleton | `LoftConstructor` |
| `DI_TYPES.ManifestManager` | `ManifestManager` class | Singleton | `ManifestManagerConstructor` |
| `DI_TYPES.ManifestManagerConfig` | `ManifestManagerConfig` object | Constant value | `ManifestManagerConstructor` |
| `DI_TYPES.ManifestRepository` | `ObjectStorage` implementation | Constant value | `ManifestManagerConstructor` |
| `DI_TYPES.ChatHistoryManager` | `ChatHistoryManager` class | Transient | `ChatConstructor` |
| `DI_TYPES.MCPManager` | `MCPManager` class | Singleton | `ChatConstructor` |
| `DI_TYPES.ToolInterceptorManager` | `ToolInterceptorManager` class | Singleton | `ChatConstructor` |

### Prompt Computing

| Symbol | Bound To | Scope | Bound By |
|--------|----------|-------|----------|
| `DI_TYPES.GMComputerManager` | `ComputerManager` instance ("AgentPrompt") | Singleton (dynamic value) | `ManifestManagerConstructor` |
| `DI_TYPES.ATMComputerManager` | `ComputerManager` instance ("AITaskPrompt") | Singleton (dynamic value) | `ManifestManagerConstructor` |
| `DI_TYPES.PromptComputerManager` | `ComputerManager` instance ("Prompt") | Singleton (dynamic value) | `ManifestManagerConstructor` |

### Repositories

| Symbol | Bound To | Scope | Bound By |
|--------|----------|-------|----------|
| `DI_TYPES.SessionRepository` | `Repository.Session` implementation | Constant value | `ChatConstructor` (via `SessionRepositoryConstructor`) |
| `DI_TYPES.ChatHistoryRepository` | `Repository.ChatHistory` implementation | Constant value | `ChatConstructor` (via `ChatHistoryRepositoryConstructor`) |
| `DI_TYPES.ChatHistoryPatcherRepository` | `Repository.ChatHistoryPatcher` implementation | Constant value | `ChatConstructor` (optional, via constructor param) |

### Middleware

| Symbol | Bound To | Scope | Bound By |
|--------|----------|-------|----------|
| `DI_TYPES.InputMiddleware` | `StandardMiddlewareManager` instance | Constant value | `ChatConstructor` |
| `DI_TYPES.BeforeGenerateMiddlewareManager` | `BeforeGenerateMiddlewareManager` instance | Constant value | `ChatConstructor` |
| `DI_TYPES.AfterGenerateMiddlewareManager` | `StandardMiddlewareManager` instance | Constant value | `ChatConstructor` |

### Infrastructure

| Symbol | Bound To | Scope | Bound By |
|--------|----------|-------|----------|
| `DI_TYPES.TracerStrategy` | `TracerFactory` implementation (default: `NoOpTracerStrategy`) | Constant value | `LoftConstructor` |
| `DI_TYPES.ContextProvider` | `ContextProvider` class | Singleton | `ChatConstructor` |
| `DI_TYPES.GenerateResultMessagesProvider` | `GenerateResultMessagesProvider` class | Transient | `ChatConstructor` |
| `DI_TYPES.LlmContextWindowCropper` | `LlmContextWindowCropper` (custom or default) | Singleton | `ChatConstructor` |
| `DI_TYPES.LoftHealthCheck` | `LoftHealthCheck` class | Transient | `ChatConstructor` |

### Legacy / Advanced

These symbols exist in `DI_TYPES` but are not actively bound in the standard initialization flow:

| Symbol | Purpose | Status |
|--------|---------|--------|
| `DI_TYPES.BaseLoft` | Alternative LOFT binding | Legacy |
| `DI_TYPES.StreamLoft` | Reserved; nothing is bound to it | Unused: stream with `chat.generate({ onEvent })` |
| `DI_TYPES.QueuedLoft` | Reserved for a queued mode | Not available yet |
| `DI_TYPES.OutgoingQueue` | Queue for outgoing messages | Legacy |
| `DI_TYPES.PromptManager` | Prompt management | Present in DI_TYPES but not actively bound |
| `DI_TYPES.ManifestRepositoryConfig` | Manifest repository configuration | Present in DI_TYPES but not actively bound |
| `DI_TYPES.ResultCallBack` | Callback for results | Legacy |
| `DI_TYPES.ErrorHandler` | Error handling | Legacy |

## Container Structure

Symbols are bound in two containers with a parent-child relationship:

```
Main Container (created by LoftConstructor)
│
│  Binds: LOFT, LlmManager, FocusRegistry, TracerStrategy, ChatStrategy,
│         ManifestManager (via module), ManifestManagerConfig,
│         ManifestRepository, GMComputerManager, ATMComputerManager,
│         PromptComputerManager
│
└── Chat Container (child, created by ChatConstructor)
    │  parent = Main Container
    │
    │  Binds: SessionRepository, ChatHistoryRepository,
    │         ChatHistoryPatcherRepository, ChatHistoryManager,
    │         ContextProvider, MCPManager, ToolInterceptorManager,
    │         InputMiddleware, BeforeGenerateMiddlewareManager,
    │         AfterGenerateMiddlewareManager, LlmContextWindowCropper,
    │         ChatConfig, LoftHealthCheck, GenerateResultMessagesProvider,
    │         BaseLoftChat (internal, re-exposed to main via ChatStrategy)
```

The child container resolves from its parent when a binding isn't found locally. This is how `BaseLoftChat` (in the chat container) accesses `LlmManager` and `ManifestManager` (in the main container).

## Using DI_TYPES

### In LOFT source code (for contributors)

```typescript
import { DI_TYPES, Interface } from '@moc-global/loft-definitions';
import { inject, injectable } from 'inversify';

@injectable()
export class MyService {
  constructor(
    @inject(DI_TYPES.LlmManager) private readonly llmManager: Interface.LlmManager,
    @inject(DI_TYPES.SessionRepository) private readonly sessionRepo: Repository.Session
  ) {}
}
```

### For consumers

You typically don't interact with `DI_TYPES` directly. The constructors handle all binding. You only encounter DI symbols if you're:
- Writing a custom `BaseComponentConstructor` or `BaseModuleConstructor`
- Extending LOFT's core services
- Reading LOFT's source code to understand wiring
