# Core Concepts

This page explains the four foundational concepts you need to understand before working with LOFT: Dependency Injection, the Strategy Pattern, the Middleware Pipeline, and the Manifest System.

## 1. Dependency Injection

LOFT uses [Inversify](https://inversify.io/) for dependency injection. You never instantiate core services like `LOFT`, `LlmManager`, or `ChatHistoryManager` directly — they're created and wired together by the DI container.

> **Important:** Inversify requires `import 'reflect-metadata'` as the very first line of your application entry point. This side-effect import enables TypeScript decorator metadata used by `@inject()` and `@injectable()`. Without it, you'll get cryptic runtime errors about missing metadata. `reflect-metadata` and `inversify` are peer dependencies of `@moc-global/loft`, so install them in your project yourself (as shown in the [Quickstart](./quickstart.md)).

### Constructors: How you configure LOFT

You interact with LOFT through three constructors that configure the DI container:

```
LoftConstructor(config, manifestManagerConstructor, chatConstructor?, tracer?, logStrategy?)
     │
     ├── ManifestManagerConstructor(storageConstructor, manifestConfig)
     │       └── FsRepositoryConstructor() / AwsS3RepositoryConstructor(config) / ...
     │
     └── ChatConstructor(sessionRepoConstructor, chatHistoryRepoConstructor, ...)
             ├── SessionRepositoryConstructor(dialect, config)
             └── ChatHistoryRepositoryConstructor(dialect, config)
```

- **`LoftConstructor`** — The main entry point. Creates the Inversify container and binds the core services (`LOFT`, `LlmManager`, `FocusRegistry`, `TracerStrategy`). After construction, you register LLM strategies and prompt computers on it, then call `getInstance()` to get the fully wired `LOFT` instance. The `chatConstructor` parameter is optional — omit it only if you don't need the chat workflow (session management, history, middleware). Most applications will provide it.

- **`ManifestManagerConstructor`** — Configures how LOFT loads manifest files (system prompts, model presets). Takes a manifest storage backend (local filesystem, S3, GCS, or Azure Blob) and configuration (file paths, cache TTL). Note: this storage is for manifest JSON files only — it is separate from session and chat history storage.

- **`ChatConstructor`** — Configures the chat pipeline. Wires up session storage, chat history storage, middleware managers, MCP manager, and context window management. This is also where you register middleware and MCP clients. Session and chat history storage use separate repository interfaces (`Repository.Session` and `Repository.ChatHistory`) — PostgreSQL implementations are provided out of the box, but you can implement these interfaces for any database.

### DI_TYPES: The symbol registry

Every injectable service is identified by a symbol defined in `DI_TYPES` (from `@moc-global/loft-definitions`). These symbols are the keys used to bind and resolve services in the Inversify container:

```typescript
import { DI_TYPES } from '@moc-global/loft-definitions';

// Key symbols you'll encounter:
DI_TYPES.LOFT                          // The LOFT orchestrator instance
DI_TYPES.ChatStrategy                  // The chat workflow (BaseLoftChat)
DI_TYPES.LlmManager                   // Manages registered LLM strategies
DI_TYPES.ManifestManager               // Loads and caches manifest files
DI_TYPES.SessionRepository             // Session persistence
DI_TYPES.ChatHistoryRepository         // Chat history persistence
DI_TYPES.ChatHistoryManager            // Chat history operations
DI_TYPES.InputMiddleware               // Input middleware manager
DI_TYPES.BeforeGenerateMiddlewareManager // Pre-LLM middleware manager
DI_TYPES.AfterGenerateMiddlewareManager  // Post-LLM middleware manager
DI_TYPES.TracerStrategy                // Observability/tracing
DI_TYPES.MCPManager                    // MCP tool integration
```

You typically don't interact with `DI_TYPES` directly as a consumer — the constructors handle the binding. But understanding them helps when reading LOFT's source code or writing advanced extensions.

### Modules vs Components

LOFT has two constructor base classes that define how services integrate with the DI container:

- **`BaseModuleConstructor`** — For services that contribute bindings to the main container (e.g., `ManifestManagerConstructor`). They provide a `ContainerModule` that the main container loads directly.

- **`BaseComponentConstructor`** — For services that have their own child container (e.g., `ChatConstructor`, `SessionRepositoryConstructor`). They create an independent container, initialize it, and expose a `getInstance()` method.

This distinction matters when you build custom storage backends or extensions.

## 2. Strategy Pattern

LOFT uses the Strategy Pattern to make LLM providers, storage backends, and call managers pluggable. You choose which implementations to use at initialization time.

### LLM Strategies

Every LLM provider implements the `LoftLLM` interface (defined in `@moc-global/loft-definitions`). The key methods:

- `generate()` — Make a synchronous LLM call
- `generateStream()` — Optional streaming call; LOFT does not expose streaming through `loft.chat` yet
- `formatToLLMRequest()` — Convert LOFT's unified message format to provider-specific format
- `formatToUnifiedLLMResponse()` — Convert provider response back to LOFT's unified format
- `generateModelPresetSchema()` — Return a Zod schema for validating model presets

Available implementations:

| Package | Class | LLM Provider |
|---------|-------|-------------|
| `@moc-global/loft-openai-strategy` | `OpenAiLoftStrategy` | OpenAI (GPT-4, etc.) |
| `@moc-global/loft-openai-strategy` | `AzureOpenAiLoftStrategy` | Azure OpenAI |
| `@moc-global/loft-anthropic-strategy` | `AnthropicLoftStrategy` | Anthropic (Claude) |
| `@moc-global/loft-gemini-strategy` | (Gemini strategy) | Google Gemini / Vertex AI |

Each strategy has three logical layers (though the wiring differs — OpenAI and Gemini use class inheritance from `AbstractLoftLLM`, while Anthropic uses composition due to TypeScript generic type constraints):

```
LoftStrategy (e.g., OpenAiLoftStrategy)
  → knows how to format messages and parse responses
  │
  └── NativeCallManagerStrategy
        → wraps a GenerateCallManager for rate limiting and retries
        │
        └── CallStrategy (e.g., OpenAiCallStrategy)
              → makes the actual HTTP call to the LLM API
```

Strategies are registered on the `LoftConstructor` by name:

```typescript
await loftConstructor.registerLlmStrategy('gpt-4o-mini', openAiStrategy);
await loftConstructor.registerLlmStrategy('claude-sonnet', anthropicStrategy);
```

The `LlmManager` routes requests to the correct strategy based on the name stored in the session or passed as a temporary override.

### Manifest Storage Strategies

Manifest files (system prompts, model presets, AI task definitions) can be stored in different backends. Each implements the `ObjectStorage` interface (`get`, `upload`, `remove`, `checkHealth`). These backends are used **exclusively for manifest storage** — they are not used for sessions or chat history.

| Package | Class | Backend |
|---------|-------|---------|
| `@moc-global/loft` | `FsRepositoryConstructor` | Local filesystem |
| `@moc-global/loft-aws-s3-repository` | `AwsS3RepositoryConstructor` | AWS S3 |
| `@moc-global/loft-gcp-storage-repository` | `GcpStorageRepositoryConstructor` | Google Cloud Storage |
| `@moc-global/loft-azure-blob-storage-repository` | `AzureBlobStorageRepositoryConstructor` | Azure Blob Storage |

### Call Manager Strategies

The call manager controls how LLM API calls are executed — rate limiting, retry logic, and prioritization:

- **`NativeCallManagerStrategy`** — Wraps a `GenerateCallManager` for in-process rate limiting. This is what most applications use.
- **`HttpCallManagerStrategy`** — Delegates to an external HTTP-based call manager service (for distributed architectures).

## 3. Middleware Pipeline

Every `generate()` call passes through a three-stage middleware pipeline. Each stage has its own middleware manager where you register named middleware functions.

```
Request
  │
  ▼
┌─────────────────────┐
│  Input Middleware   │  Transform the incoming request (messages, context)
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  BeforeGenerate     │  Pre-process before LLM call. Can PREVENT generation
│  Middleware         │  and return a custom response instead.
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  LLM Generate       │  LlmManager calls the registered LLM strategy
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  AfterGenerate      │  Post-process the LLM response before returning
│  Middleware         │
└─────────┬───────────┘
          ▼
Response
```

### Registering middleware

Middleware is registered on the `ChatConstructor` by name. Names must be unique — duplicate names throw an error.

```typescript
const chatConstructor = new ChatConstructor(sessionRepo, chatHistoryRepo);

// Input middleware: transform incoming messages
chatConstructor.registerInputMiddleware('sanitize-input', async (context, payload, chain) => {
  // Modify payload.directMessages here
  chain.next();
  return payload;
});

// BeforeGenerate middleware: runs before the LLM call
chatConstructor.registerBeforeGenerateMiddleware('add-context', async (context, payload, chain) => {
  // Can modify payload, inspect context.session, context.chatHistory, etc.
  // To skip the LLM call: chain.preventGeneration({ content, role }) and return payload without calling chain.next()
  chain.next();
  return payload;
});

// AfterGenerate middleware: runs after the LLM response
chatConstructor.registerAfterGenerateMiddleware('log-response', async (context, payload, chain) => {
  // payload is a Chat.GenerateResultMessages with: llmResponse, directMessages, augmentedContext
  chain.next();
  return payload;
});
```

### Middleware execution

- Middleware executes **sequentially** in registration order
- Each middleware receives a deep copy of the payload (via `fast-copy`) for immutability
- Each middleware returns the payload and calls `chain.next()` to let the next middleware run; without `chain.next()` the chain stops after it
- BeforeGenerate middleware can call `chain.preventGeneration()` to answer without calling the LLM
- Tracer spans are created per middleware step for observability

## 4. Manifest System

Manifests separate prompt engineering from application code. They are JSON files that define system messages and model presets for each LLM.

### Structure

```json
{
  "llmManifests": {
    "<manifestName>": {
      "<llmName>": {
        "systemMessage": "You are a helpful assistant.",
        "modelPreset": {
          "model": "gpt-4o-mini",
          "temperature": 0.7,
          "max_tokens": 1000
        }
      }
    }
  },
  "prompts": { },
  "aiTasks": { }
}
```

- **`manifestName`** — A logical name for a bot/agent (e.g., `"customer-support"`, `"code-reviewer"`)
- **`llmName`** — Matches the name used when registering an LLM strategy
- **`systemMessage`** — The system prompt sent to the LLM
- **`modelPreset`** — Provider-specific model parameters (model name, temperature, max tokens, etc.). Validated at runtime against the strategy's Zod schema.

### How manifests are used

1. When a session is created, it stores `currentManifestName` and `currentLlmName`
2. On `generate()`, the `LlmManager` looks up the manifest by these names
3. The system message and model preset from the manifest are passed to the LLM strategy
4. The strategy's `formatToLLMRequest()` method uses them to build the provider-specific request

### Prompt Computers

For dynamic system messages, you can register **prompt computers** that modify the manifest at runtime:

```typescript
// GM Computer: Modify the system message before it's sent to the LLM
loftConstructor.registerGMComputer('my-assistant', 'gpt-4o-mini', async (context, prompt, modelPreset) => {
  // prompt is a Prompt object: { name: string; content: string }
  // Return the modified system message as a string
  return `${prompt.content}\nUser timezone: ${context.session.ctx.timezone}`;
});
```

Three types of computers are available:
- **GM Computer** (`registerGMComputer`) — Modifies the main generate manifest
- **ATM Computer** (`registerATMComputer`) — Modifies AI task manifests (see [AI Tasks guide](../guides/ai-tasks.md))
- **Prompt Computer** (`registerPromptComputer`) — Modifies standalone prompts

### Storage

Manifests are loaded from an `ObjectStorage` backend configured via `ManifestManagerConstructor`. The `ManifestManager` caches loaded manifests in memory with a configurable TTL (`cacheExpirationTime`).

## Putting It All Together

Here's how the concepts connect in a typical request flow:

1. **Your app** calls `loft.chat.generate({ sessionId, directMessages })`
2. **LOFT** loads the session from `SessionRepository`, which includes `currentLlmName` and `currentManifestName`
3. **Input Middleware** processes the incoming messages
4. **BeforeGenerate Middleware** runs (can modify or prevent generation)
5. **LlmManager** looks up the LLM strategy by `currentLlmName`
6. **ManifestManager** loads the manifest and applies any registered prompt computers
7. The **LLM strategy** formats the request, calls the provider API (through the call manager), and returns a unified response
8. **AfterGenerate Middleware** post-processes the response
9. Messages are persisted to `ChatHistoryRepository`
10. The response is returned to your app

## What's Next

- **[Examples](../../examples/)** — See these concepts applied in runnable projects (Express, NestJS, Lambda)
- **[Architecture](../concepts/architecture.md)** — Package tiers, dependency graph, and system design
- **[Processing Pipeline](../concepts/processing-pipeline.md)** — Full request lifecycle including MCP tool loop
- **[Strategy Pattern](../concepts/strategy-pattern.md)** — How LLM providers and storage are pluggable
- **[Configuration Reference](../reference/configuration.md)** — All config types and constructor signatures
