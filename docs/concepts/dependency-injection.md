# Dependency Injection

LOFT uses [Inversify](https://inversify.io/) for dependency injection. This page explains how the DI system works, how services are bound, and how the constructor pattern wires everything together.

## Why DI?

LOFT's components (LLM strategies, repositories, middleware, managers) need to reference each other without tight coupling. DI provides:

- **Pluggability** — Swap LLM providers, storage backends, or repositories without changing core code
- **Testability** — Mock any service by rebinding its DI symbol
- **Lazy resolution** — Services are resolved when first requested, not at import time

## DI_TYPES: The Symbol Registry

Every injectable service is identified by a unique symbol defined in `DI_TYPES` (exported from `@moc-global/loft-definitions`).

The most important symbols for consumers are:

```typescript
// Key DI_TYPES symbols (subset — see DITypes.ts for the complete list)

// Core
DI_TYPES.LOFT                              // The LOFT orchestrator
DI_TYPES.ChatStrategy                      // The chat workflow (BaseLoftChat)
DI_TYPES.ChatConfig                        // Chat configuration
DI_TYPES.FocusRegistry                     // Registered Focus configs

// Managers
DI_TYPES.LlmManager                       // LLM strategy coordinator
DI_TYPES.ManifestManager                   // Manifest loading/caching
DI_TYPES.ManifestManagerConfig             // Manifest configuration
DI_TYPES.ManifestRepository                // Manifest storage backend
DI_TYPES.ChatHistoryManager                // Chat history operations
DI_TYPES.MCPManager                        // MCP tool integration
DI_TYPES.ToolInterceptorManager            // Tool execution interception

// Prompt Computing
DI_TYPES.GMComputerManager                 // GenerateManifest computers
DI_TYPES.ATMComputerManager                // AiTaskManifest computers
DI_TYPES.PromptComputerManager             // Prompt computers

// Repositories
DI_TYPES.SessionRepository                 // Session persistence
DI_TYPES.ChatHistoryRepository             // Chat history persistence
DI_TYPES.ChatHistoryPatcherRepository      // Chat history patching

// Middleware
DI_TYPES.InputMiddleware                   // Input middleware manager
DI_TYPES.BeforeGenerateMiddlewareManager   // Pre-LLM middleware manager
DI_TYPES.AfterGenerateMiddlewareManager    // Post-LLM middleware manager

// Infrastructure
DI_TYPES.ContextProvider                   // Context builder
DI_TYPES.TracerStrategy                    // Observability/tracing
DI_TYPES.LlmContextWindowCropper          // Message history trimming
DI_TYPES.LoftHealthCheck                   // Health check service
```

The full `DI_TYPES` object also includes symbols that are internal or reserved for features that are not available yet (`BaseLoft`, `StreamLoft`, `QueuedLoft`, `OutgoingQueue`, `PromptManager`, `ManifestRepositoryConfig`, `ResultCallBack`, `ErrorHandler`). See `packages/loft-definitions/src/DITypes.ts` for the complete list.

These symbols act as keys. When a class needs a dependency, it uses `@inject(DI_TYPES.LlmManager)` to request it from the container.

## How LOFT Builds the Container

LOFT uses three constructors that each configure a portion of the DI container:

```
LoftConstructor
  │
  ├── Creates the main Container
  ├── Binds: LOFT, LlmManager, FocusRegistry, TracerStrategy, Logger config
  │
  ├── ManifestManagerConstructor.getModule(container)
  │   └── Loads a ContainerModule that binds:
  │       ManifestManager, ManifestRepository, ManifestManagerConfig,
  │       GMComputerManager, ATMComputerManager, PromptComputerManager
  │
  └── ChatConstructor.initializeContainer(container)
      └── Creates a child container that binds:
          SessionRepository, ChatHistoryRepository, ChatHistoryManager,
          InputMiddleware, BeforeGenerateMiddleware, AfterGenerateMiddleware,
          ContextProvider, MCPManager, ToolInterceptorManager,
          LlmContextWindowCropper, ChatConfig, ChatStrategy (BaseLoftChat)
```

### LoftConstructor Bindings

```typescript
// packages/loft/src/constructors/LoftConstructor.ts — bindLoftDependencies()

// Configure Logger
Logger.configure({ logLevel: loftConfig.logLevel, loggerStrategy: logStrategy });

// Core services
container.bind(DI_TYPES.LOFT).to(LOFT);
container.bind(DI_TYPES.LlmManager).to(LlmManager).inSingletonScope();
container.bind(DI_TYPES.FocusRegistry).toConstantValue(new FocusRegistry());
container.bind(DI_TYPES.TracerStrategy).toConstantValue(tracerStrategy || new NoOpTracerStrategy());
```

### ManifestManagerConstructor Bindings

`ManifestManagerConstructor` implements `BaseModuleConstructor` — it returns a `ContainerModule` that the main container loads:

```typescript
// packages/loft/src/constructors/ManifestManagerConstructor.ts

getModule(parentContainer: Container): ContainerModule {
  return new ContainerModule(async (bind) => {
    // Initialize and bind the storage backend (FS, S3, GCS, Azure)
    this.manifestRepositoryConstructor.initializeContainer(parentContainer);
    bind(DI_TYPES.ManifestRepository).toConstantValue(
      this.manifestRepositoryConstructor.getInstance()
    );

    // Bind managers
    bind(DI_TYPES.ManifestManager).to(ManifestManager).inSingletonScope();
    bind(DI_TYPES.ManifestManagerConfig).toConstantValue(this.manifestManagerConfig);

    // Bind prompt computer managers (singleton — registered computers persist)
    bind(DI_TYPES.GMComputerManager)
      .toDynamicValue(() => new ComputerManager('AgentPrompt')).inSingletonScope();
    bind(DI_TYPES.ATMComputerManager)
      .toDynamicValue(() => new ComputerManager('AITaskPrompt')).inSingletonScope();
    bind(DI_TYPES.PromptComputerManager)
      .toDynamicValue(() => new ComputerManager('Prompt')).inSingletonScope();
  });
}
```

### ChatConstructor Bindings

`ChatConstructor` implements `BaseComponentConstructor` — it creates its own **child container** linked to the main container via `parent`:

```typescript
// packages/loft/src/constructors/ChatConstructor.ts — initializeContainer()

this.chatContainer.parent = mainContainer;  // Child can resolve from parent

// Repository wiring
sessionRepositoryConstructor.initializeContainer(this.chatContainer);
bind(DI_TYPES.SessionRepository).toConstantValue(sessionRepositoryConstructor.getInstance());

chatHistoryRepositoryConstructor.initializeContainer(this.chatContainer);
bind(DI_TYPES.ChatHistoryRepository).toConstantValue(chatHistoryRepositoryConstructor.getInstance());

// Middleware managers (empty at first — middleware added via register* methods)
bind(DI_TYPES.InputMiddleware).toConstantValue(createStandardMiddlewareManager('Input'));
bind(DI_TYPES.BeforeGenerateMiddlewareManager).toConstantValue(createBeforeGenerateMiddlewareManager('BeforeGenerate'));
bind(DI_TYPES.AfterGenerateMiddlewareManager).toConstantValue(createStandardMiddlewareManager('AfterGenerate'));

// Services
bind(DI_TYPES.ChatHistoryManager).to(ChatHistoryManager);
bind(DI_TYPES.ContextProvider).to(ContextProvider).inSingletonScope();
bind(DI_TYPES.MCPManager).to(MCPManager).inSingletonScope();
bind(DI_TYPES.ToolInterceptorManager).to(ToolInterceptorManager).inSingletonScope();
bind(DI_TYPES.ChatConfig).toConstantValue(chatConfig || { mcp: { toolCacheTtl: 60000 } });

// The chat workflow (bound internally; LoftConstructor re-binds the instance to the main container)
bind(DI_TYPES.ChatStrategy).to(BaseLoftChat).inSingletonScope();
```

## Modules vs Components

LOFT defines two base classes for constructors that determine how a service integrates with the DI container:

### BaseModuleConstructor

```typescript
// packages/loft-definitions/src/interfaces/ComponentConstructor.ts
export abstract class BaseModuleConstructor<Module> {
  abstract getModule(parentContainer: Container): ContainerModule;
}
```

- Returns a `ContainerModule` that the main container **loads directly**
- Bindings become part of the main container
- Used for: `ManifestManagerConstructor`

### BaseComponentConstructor

```typescript
// packages/loft-definitions/src/interfaces/ComponentConstructor.ts
export abstract class BaseComponentConstructor<Component> {
  abstract initializeContainer(mainContainer: Container): void;
  abstract getInstance(): Component;
}
```

- Creates its own container (often a **child** of the main container)
- The main container only sees the final instance via `getInstance()`
- Used for: `ChatConstructor`, `SessionRepositoryConstructor`, `ChatHistoryRepositoryConstructor`, `FsRepositoryConstructor`, storage constructors

### When to use which

| Use | When |
|-----|------|
| `BaseModuleConstructor` | Your service contributes **multiple bindings** to the main container (like ManifestManagerConstructor which binds ManifestManager + ComputerManagers + config) |
| `BaseComponentConstructor` | Your service is a **standalone unit** with its own setup that exposes a single instance (like a repository or the chat pipeline) |

## Container Hierarchy

The final container structure looks like this:

```
Main Container (LoftConstructor)
  ├── LOFT
  ├── LlmManager (singleton)
  ├── TracerStrategy
  ├── ManifestManager (singleton, from module)
  ├── ManifestManagerConfig
  ├── ManifestRepository (from component)
  ├── GMComputerManager, ATMComputerManager, PromptComputerManager
  │
  └── Chat Container (child, ChatConstructor)
        ├── parent → Main Container (can resolve LlmManager, ManifestManager, etc.)
        ├── ChatStrategy (BaseLoftChat, singleton — also exposed to main container via toConstantValue)
        ├── SessionRepository (from component)
        ├── ChatHistoryRepository (from component)
        ├── ChatHistoryManager
        ├── ContextProvider (singleton)
        ├── MCPManager (singleton)
        ├── ToolInterceptorManager (singleton)
        ├── InputMiddleware manager
        ├── BeforeGenerateMiddlewareManager
        ├── AfterGenerateMiddlewareManager
        ├── LlmContextWindowCropper
        └── ChatConfig
```

The child container resolves from its parent when a binding isn't found locally. This is how `BaseLoftChat` (in the chat container) can access `LlmManager` (in the main container).

## Scope Behaviors

| Scope | Behavior | Used for |
|-------|----------|----------|
| `.inSingletonScope()` | One instance per container | `LlmManager`, `MCPManager`, `ContextProvider` |
| `.toConstantValue(x)` | Pre-created instance | Config objects, repository instances |
| `.to(Class)` (default) | New instance per resolution | `ChatHistoryManager`, `GenerateResultMessagesProvider` |
| `.toDynamicValue(() => ...)` | Factory function per resolution | `ComputerManager` instances |

## What's Next

- **[Strategy Pattern](./strategy-pattern.md)** — How pluggable LLM providers and storage backends work
- **[Architecture](./architecture.md)** — Package tiers and dependency graph
