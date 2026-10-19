# Quickstart

Get a working LOFT instance in 15 minutes. This guide shows two variants — pick the LLM provider you prefer.

## Prerequisites

- Node.js 22.12 or later (the PostgreSQL storage and the call manager load ES module-only dependencies through `require()`)
- A package manager: npm, yarn, or pnpm
- An API key for [OpenAI](https://platform.openai.com/) or [Anthropic](https://console.anthropic.com/)
- PostgreSQL database (optional — used in this guide for session and chat history; other databases possible via custom repositories)

> **Package manager:** This guide uses `npm`. Substitute `yarn add` or `pnpm add` for the install commands if that's what your project uses.

> **Note:** PostgreSQL is the out-of-the-box storage option for sessions and chat history, but it is not a hard requirement. LOFT defines abstract `Repository.Session` and `Repository.ChatHistory` interfaces (in `@moc-global/loft-definitions`) that you can implement for any database. See [Strategy Pattern — Repository Strategies](../concepts/strategy-pattern.md#repository-strategies) for details.

## 1. Install Packages

Both variants need the core packages plus a storage layer for sessions and chat history. This guide uses the built-in PostgreSQL repositories:

```bash
# Core framework and the libraries it shares with your code (peer dependencies)
npm install @moc-global/loft @moc-global/loft-definitions
npm install reflect-metadata inversify@^6 zod@^3.25.67 @modelcontextprotocol/sdk

# PostgreSQL repositories (the OOTB option for sessions and chat history)
npm install @moc-global/loft-session-pg-repository @moc-global/loft-chat-history-pg-repository

# Rate limiting and token management
npm install @moc-global/loft-llm-call-manager

# PostgreSQL client
npm install pg
```

LOFT declares inversify, reflect-metadata, zod, the MCP SDK, `@moc-global/loft-definitions` and the LLM provider SDKs as peer dependencies, so your project and LOFT share one copy of each. LOFT needs inversify 6: a plain `npm install inversify` installs a newer major version that does not fit. npm 7 or later and pnpm install missing peers on their own; Yarn only warns, so list them yourself.

Then add your LLM provider:

```bash
# Option A: OpenAI
npm install @moc-global/loft-openai-strategy openai@^7

# Option B: Anthropic
npm install @moc-global/loft-anthropic-strategy @anthropic-ai/sdk
```

## 2. Set Up the Database

This quickstart uses the built-in PostgreSQL repositories. They use separate schemas for sessions and chat history.

### Create the schemas

Create a file `init-schemas.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA IF NOT EXISTS loft_session;
CREATE SCHEMA IF NOT EXISTS loft_chat_history;
```

Run it against your PostgreSQL database, or include it in your Docker init scripts.

### Run migrations

The repository packages ship CLI migration tools:

```bash
# Set your database connection
export DATABASE_URL=postgresql://your_user:your_pass@localhost:5432/your_db
export DATABASE_SESSION_SCHEMA_NAME=loft_session
export DATABASE_CHAT_HISTORY_SCHEMA_NAME=loft_chat_history

# Run migrations
npx loft-session-pg-migrate to-latest --env .env
npx loft-chat-history-pg-migrate to-latest --env .env
```

## 3. Create a Manifest File

LOFT uses JSON manifest files to define system prompts and model presets, separating prompt engineering from application code.

Create `manifest/manifest.json` in your project root:

```json
{
  "llmManifests": {
    "my-assistant": {
      "gpt-4o-mini": {
        "systemMessage": "You are a helpful assistant.",
        "modelPreset": {
          "model": "gpt-4o-mini",
          "temperature": 0.7,
          "max_tokens": 1000
        }
      },
      "claude-sonnet": {
        "systemMessage": "You are a helpful assistant.",
        "modelPreset": {
          "model": "claude-sonnet-5-5",
          "max_tokens": 1000
        }
      }
    }
  },
  "prompts": {},
  "aiTasks": {}
}
```

The outer key (`my-assistant`) is the **manifest name**. Inside, each key is an **LLM name** that maps to a model configuration. You'll reference both when creating sessions and registering strategies.

## 4. Initialize LOFT

### Option A: OpenAI

```typescript
import 'reflect-metadata';
import { Pool } from 'pg';
import {
  ChatConstructor,
  FsRepositoryConstructor,
  LoftConstructor,
  ManifestManagerConstructor
} from '@moc-global/loft';
import {
  ChatHistoryPostgresDialect,
  ChatHistoryRepositoryConstructor
} from '@moc-global/loft-chat-history-pg-repository';
// NativeCallManagerStrategy wraps a GenerateCallManager for in-process call management.
// It lives in loft-definitions because it implements a core Strategy interface.
import { Interface, NativeCallManagerStrategy } from '@moc-global/loft-definitions';
import { GenerateCallManager, LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';
import {
  OpenAiCallStrategy,
  OpenAiLoftStrategy,
  OpenAiRequest,
  OpenAiResponse
} from '@moc-global/loft-openai-strategy';
import {
  SessionPostgresDialect,
  SessionRepositoryConstructor
} from '@moc-global/loft-session-pg-repository';

// --- Database ---
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'your_db',
  user: 'your_user',
  password: 'your_pass'
});

const sessionRepoConstructor = new SessionRepositoryConstructor(
  new SessionPostgresDialect({ pool }),
  { schema: 'loft_session' }
);

const chatHistoryRepoConstructor = new ChatHistoryRepositoryConstructor(
  new ChatHistoryPostgresDialect({ pool }),
  { schema: 'loft_chat_history' }
);

// --- Chat Constructor ---
const chatConstructor = new ChatConstructor(sessionRepoConstructor, chatHistoryRepoConstructor);

// --- Manifest Manager (local filesystem) ---
const manifestRepository = new FsRepositoryConstructor();
const manifestManagerConstructor = new ManifestManagerConstructor(manifestRepository, {
  manifestPath: 'manifest/manifest.json',
  errorPath: 'manifest/errors/error.json',
  cacheExpirationTime: 3600000 // 1 hour
});

// --- LOFT Constructor ---
const loftConstructor = new LoftConstructor(
  { logLevel: Interface.LogLevel.INFO },
  manifestManagerConstructor,
  chatConstructor
);

// --- Register OpenAI Strategy ---
function createOpenAiStrategy(modelName: string) {
  const callStrategy = new OpenAiCallStrategy(
    process.env.OPENAI_API_KEY!,
    new LlmTokenRateLimiter({
      newTokensPerSecond: 50000,
      newRequestsPerSecond: 100,
      maxRequests: 500,
      maxTokens: 2000000,
      maxAwaitSeconds: 300
    }),
    new LlmTokenizer()
  );

  const callManager = new GenerateCallManager<OpenAiRequest, OpenAiResponse>(
    modelName,
    { highPriorityTasksLimit: 10, retryDelay: 1000, retryAttemptsLimit: 3 },
    callStrategy
  );

  return new OpenAiLoftStrategy(
    { llmName: modelName },
    new NativeCallManagerStrategy(callManager)
  );
}

await loftConstructor.registerLlmStrategy('gpt-4o-mini', createOpenAiStrategy('gpt-4o-mini'));

// --- Get LOFT Instance ---
const loft = loftConstructor.getInstance();
```

### Option B: Anthropic

The setup is identical except for the LLM strategy registration. Replace the strategy section above with:

```typescript
import {
  AnthropicCallStrategy,
  AnthropicLoftStrategy,
  AnthropicRequest,
  AnthropicResponse
} from '@moc-global/loft-anthropic-strategy';

// --- Register Anthropic Strategy ---
function createAnthropicStrategy(modelName: string) {
  const callStrategy = new AnthropicCallStrategy(
    { apiKey: process.env.ANTHROPIC_API_KEY! },
    new LlmTokenRateLimiter({
      newTokensPerSecond: 50000,
      newRequestsPerSecond: 100,
      maxRequests: 500,
      maxTokens: 2000000,
      maxAwaitSeconds: 300
    }),
    new LlmTokenizer()
  );

  const callManager = new GenerateCallManager<AnthropicRequest, AnthropicResponse>(
    modelName,
    { highPriorityTasksLimit: 10, retryDelay: 1000, retryAttemptsLimit: 3 },
    callStrategy
  );

  return new AnthropicLoftStrategy(
    { llmName: modelName },
    new NativeCallManagerStrategy(callManager)
  );
}

await loftConstructor.registerLlmStrategy('claude-sonnet', createAnthropicStrategy('claude-sonnet'));
```

### Key Difference

- `OpenAiCallStrategy` takes an API key string as its first argument
- `AnthropicCallStrategy` takes an Anthropic `ClientOptions` object (e.g., `{ apiKey: '...' }`)

Both follow the same pattern: CallStrategy → GenerateCallManager → LoftStrategy → NativeCallManagerStrategy → register.

## 5. Use LOFT

Once initialized, LOFT exposes a `chat` interface for creating sessions and generating responses:

```typescript
import { Type } from '@moc-global/loft-definitions';

// Create a session
const session = await loft.chat.createSession({
  currentLlmName: 'gpt-4o-mini',       // or 'claude-sonnet' for Anthropic
  currentManifestName: 'my-assistant',
  ctx: {}
});

// Generate a response
// Note: `content` is an array of content parts, not a plain string.
// Each part has a `type` (e.g., 'text', 'image', 'tool_call') and type-specific fields.
const result = await loft.chat.generate({
  sessionId: session.id,
  directMessages: [
    {
      content: [{ type: 'text', text: 'Hello! What can you help me with?' }],
      role: Type.LLM.UnifiedMessageRole.user,
      author: 'user',
      sessionId: session.id,
      llmName: 'gpt-4o-mini',          // or 'claude-sonnet'
      manifestName: 'my-assistant',
      ctx: {},
      llmIgnore: false
    }
  ]
});

// Access the LLM response
// `topChoice.content` is an array of content parts — extract the text:
const textPart = result.messages.llmResponse.topChoice.content.find(
  (part): part is Type.Entity.TextContent => part.type === 'text'
);
console.log(textPart?.text);

// Store the user message and the reply in the chat history
await result.messages.save();
```

### What happens under the hood

1. `createSession()` persists a new session via the `SessionRepository` (PostgreSQL in this example)
2. `generate()` runs the request through the middleware pipeline:
   - **Input Middleware** processes `directMessages`
   - **BeforeGenerate Middleware** can modify or prevent the LLM call
   - **LlmManager** routes to the registered strategy (OpenAI or Anthropic), loads the manifest for model presets and system message, and calls the LLM
   - **AfterGenerate Middleware** post-processes the response
3. `generate()` does not store anything. `result.messages.save()` stores the user message, any tool calls and the reply in chat history
4. Later `generate()` calls on the same session load the stored history and send it with the new message

## What's Next

- **[Examples](../../examples/)** — Runnable example applications (Express, NestJS, serverless) — copy, configure, and run
- **[Core Concepts](./core-concepts.md)** — Understand DI, strategies, middleware, and manifests in depth
- **[Architecture](../concepts/architecture.md)** — Package tiers and dependency graph
- **[Processing Pipeline](../concepts/processing-pipeline.md)** — Full request lifecycle detail
- **[Configuration Reference](../reference/configuration.md)** — All config types and constructor signatures
