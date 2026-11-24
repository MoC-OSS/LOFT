# LOFT Setup Patterns

## Contents

- Install
- TypeScript Requirements
- Common Foundation (all setups share this)
- Per-LLM-Provider Setup
- Per-Framework Patterns
- Per-Storage-Backend Setup
- Adding Middleware
- Manifest File Structure
- Session & Chat Usage
- Graceful Shutdown
- Database Setup

Verified boilerplate for integrating `@moc-global/loft` 3.0.0. Every snippet confirmed against monorepo source.

---

## Install

Node.js 22 or later; 22.12 or later for the PostgreSQL repositories and the call manager.

```bash
npm install @moc-global/loft @moc-global/loft-definitions @moc-global/loft-llm-call-manager \
  @moc-global/loft-openai-strategy \
  @moc-global/loft-session-pg-repository @moc-global/loft-chat-history-pg-repository \
  reflect-metadata inversify@^6 zod@^4.6.6 @modelcontextprotocol/sdk openai@^7 pg
```

inversify, reflect-metadata, zod, the MCP SDK and the provider SDK are peer dependencies: inversify 6 (not the latest major) and zod 4 (`^4.6.6`). With Yarn, list them explicitly.

| Provider | Package | Provider SDK peer |
|----------|---------|-------------------|
| OpenAI / Azure OpenAI | `@moc-global/loft-openai-strategy` | `openai@^7` (`^7.34.0`) |
| Anthropic | `@moc-global/loft-anthropic-strategy` | `@anthropic-ai/sdk` (`>=0.39.0 <1`) |
| Gemini | `@moc-global/loft-gemini-strategy` | `@google/genai` (`^1.30.0 \|\| ^2.30.0`) |

`langfuse` is an optional peer of `@moc-global/loft`; install it only when using `LangfuseTracer`.

---

## TypeScript Requirements

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "strict": true
  }
}
```

Both decorator flags are required by Inversify DI.

---

## Common Foundation (all setups share this)

### 1. reflect-metadata — Must Be First Import

```typescript
import 'reflect-metadata';  // MUST be first line of entry point
```

### 2. Database + Repository Constructors

```typescript
import { Pool } from 'pg';
import { SessionPostgresDialect, SessionRepositoryConstructor } from '@moc-global/loft-session-pg-repository';
import { ChatHistoryPostgresDialect, ChatHistoryRepositoryConstructor } from '@moc-global/loft-chat-history-pg-repository';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const sessionRepoConstructor = new SessionRepositoryConstructor(
  new SessionPostgresDialect({ pool }),
  { schema: 'loft_session' }
);
const chatHistoryRepoConstructor = new ChatHistoryRepositoryConstructor(
  new ChatHistoryPostgresDialect({ pool }),
  { schema: 'loft_chat_history' }
);
```

### 3. ChatConstructor + ManifestManager + LoftConstructor

```typescript
import { ChatConstructor, FsRepositoryConstructor, LoftConstructor, ManifestManagerConstructor } from '@moc-global/loft';
import { Interface } from '@moc-global/loft-definitions';

const chatConstructor = new ChatConstructor(sessionRepoConstructor, chatHistoryRepoConstructor);
// Optional 5th argument, ChatConfig: { shutdownTimeout?, historyLimit?, mcp?, streaming? }
// new ChatConstructor(sessionRepoConstructor, chatHistoryRepoConstructor, undefined, undefined, { shutdownTimeout: 30_000 });

const manifestManagerConstructor = new ManifestManagerConstructor(
  new FsRepositoryConstructor(),
  { manifestPath: 'manifest/manifest.json', errorPath: 'manifest/errors/error.json', cacheExpirationTime: 3_600_000 }
);

const loftConstructor = new LoftConstructor(
  { logLevel: Interface.LogLevel.INFO },
  manifestManagerConstructor,
  chatConstructor
);
```

### 4. Register Strategy + Get Instance

```typescript
await loftConstructor.registerLlmStrategy('gpt-4o-mini', createOpenAiStrategy('gpt-4o-mini'));
const loft = loftConstructor.getInstance();
```

---

## Per-LLM-Provider Setup

Every provider uses the same three layers: call strategy → `GenerateCallManager` → LOFT strategy wrapped around `NativeCallManagerStrategy`.

### OpenAI

```typescript
import { NativeCallManagerStrategy } from '@moc-global/loft-definitions';
import { GenerateCallManager, LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';
import { OpenAiCallStrategy, OpenAiLoftStrategy, OpenAiRequest, OpenAiResponse } from '@moc-global/loft-openai-strategy';

function createOpenAiStrategy(modelName: string) {
  const callStrategy = new OpenAiCallStrategy(
    process.env.OPENAI_API_KEY!,           // plain string
    new LlmTokenRateLimiter({ newTokensPerSecond: 50_000, newRequestsPerSecond: 100, maxRequests: 500, maxTokens: 2_000_000, maxAwaitSeconds: 300 }),
    new LlmTokenizer()
  );
  const callManager = new GenerateCallManager<OpenAiRequest, OpenAiResponse>(
    modelName,
    { highPriorityTasksLimit: 10, retryDelay: 1000, retryAttemptsLimit: 3 },
    callStrategy
  );
  return new OpenAiLoftStrategy({ llmName: modelName }, new NativeCallManagerStrategy(callManager));
}
```

### Azure OpenAI

```typescript
import { NativeCallManagerStrategy } from '@moc-global/loft-definitions';
import { GenerateCallManager, LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';
import { AzureOpenAiCallStrategy, AzureOpenAiLoftStrategy, OpenAiRequest, OpenAiResponse } from '@moc-global/loft-openai-strategy';

function createAzureOpenAiStrategy(modelName: string) {
  const callStrategy = new AzureOpenAiCallStrategy(
    {
      endpoint: process.env.AZURE_OPENAI_ENDPOINT!,          // e.g. 'https://my-resource.openai.azure.com'
      deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT!,
      auth: { type: 'api-key', apiKey: process.env.AZURE_OPENAI_API_KEY! }
      // Or: auth: { type: 'azure-ad' }  // uses DefaultAzureCredential
      // apiVersion is optional; a default version is used without it
    },
    new LlmTokenRateLimiter({ newTokensPerSecond: 50_000, newRequestsPerSecond: 100, maxRequests: 500, maxTokens: 2_000_000, maxAwaitSeconds: 300 }),
    new LlmTokenizer()
  );
  const callManager = new GenerateCallManager<OpenAiRequest, OpenAiResponse>(
    modelName, { highPriorityTasksLimit: 10, retryDelay: 1000, retryAttemptsLimit: 3 }, callStrategy
  );
  return new AzureOpenAiLoftStrategy({ llmName: modelName }, new NativeCallManagerStrategy(callManager));
}
```

### Anthropic

```typescript
import { NativeCallManagerStrategy } from '@moc-global/loft-definitions';
import { GenerateCallManager, LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';
import { AnthropicCallStrategy, AnthropicLoftStrategy, AnthropicRequest, AnthropicResponse } from '@moc-global/loft-anthropic-strategy';

function createAnthropicStrategy(modelName: string) {
  const callStrategy = new AnthropicCallStrategy(
    { apiKey: process.env.ANTHROPIC_API_KEY! },  // ClientOptions object, NOT plain string
    new LlmTokenRateLimiter({ newTokensPerSecond: 50_000, newRequestsPerSecond: 100, maxRequests: 500, maxTokens: 2_000_000, maxAwaitSeconds: 300 }),
    new LlmTokenizer()
  );
  const callManager = new GenerateCallManager<AnthropicRequest, AnthropicResponse>(
    modelName, { highPriorityTasksLimit: 10, retryDelay: 1000, retryAttemptsLimit: 3 }, callStrategy
  );
  return new AnthropicLoftStrategy({ llmName: modelName }, new NativeCallManagerStrategy(callManager));
}
```

### Gemini

```typescript
import { NativeCallManagerStrategy } from '@moc-global/loft-definitions';
import { GenerateCallManager, LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';
import { GeminiCallStrategy, GeminiLoftStrategy, GeminiRequest, GeminiResponse, GeminiStrategyConfig } from '@moc-global/loft-gemini-strategy';

function createGeminiStrategy(modelName: string) {
  // Vertex AI mode (GCP, Application Default Credentials); location defaults to 'us-central1'
  const config: GeminiStrategyConfig = { mode: 'vertexai', project: 'my-gcp-project', location: 'us-central1' };
  // Or API key mode (Google AI Studio): { mode: 'apikey', apiKey: process.env.GOOGLE_API_KEY! }

  const callStrategy = new GeminiCallStrategy(
    config,
    new LlmTokenRateLimiter({ newTokensPerSecond: 50_000, newRequestsPerSecond: 50, maxRequests: 500, maxTokens: 2_000_000, maxAwaitSeconds: 300 }),
    new LlmTokenizer()
  );
  const callManager = new GenerateCallManager<GeminiRequest, GeminiResponse>(
    modelName, { highPriorityTasksLimit: 10, retryDelay: 1000, retryAttemptsLimit: 3 }, callStrategy
  );
  return new GeminiLoftStrategy({ llmName: modelName }, new NativeCallManagerStrategy(callManager));
}
```

---

## Per-Framework Patterns

### Express (basic — ephemeral sessions)

```typescript
import 'reflect-metadata';
import { Type } from '@moc-global/loft-definitions';
import crypto from 'crypto';
import express from 'express';

const app = express();
app.use(express.json());

app.post('/chat', async (req, res) => {
  const { message } = req.body;
  const session = await loft.chat.createSession({
    currentLlmName: 'gpt-4o-mini', currentManifestName: 'my-assistant', ctx: {},
    externalKey: { requestId: crypto.randomUUID() }
  });
  const result = await loft.chat.generate({
    sessionId: session.id,
    directMessages: [{
      sessionId: session.id,
      content: [{ type: 'text', text: message }],
      role: Type.LLM.UnifiedMessageRole.user,
      author: 'user', llmName: 'gpt-4o-mini', manifestName: 'my-assistant', ctx: {}, llmIgnore: false
    }]
  });
  const text = result.messages.llmResponse.topChoice.content
    .filter((p): p is Type.Entity.TextContent => p.type === 'text')
    .map(p => p.text).join('');
  await loft.chat.deleteSession(session.id);
  res.json({ response: text });
});
```

### Express (persistent multi-turn sessions)

```typescript
import { SessionNotFoundError, Type } from '@moc-global/loft-definitions';
import crypto from 'crypto';

// Create session
app.post('/api/sessions', async (_req, res) => {
  const session = await loft.chat.createSession({
    currentLlmName: 'gpt-4o-mini', currentManifestName: 'my-assistant', ctx: {}
  });
  res.json({ sessionId: session.id });
});

// Chat — uses stored history
app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body;
  const userMessage: Type.Entity.CreateMessage = {
    sessionId, content: [{ type: 'text', text: message }], role: Type.LLM.UnifiedMessageRole.user,
    author: 'user', llmName: 'gpt-4o-mini', manifestName: 'my-assistant', ctx: {}, llmIgnore: false
  };
  try {
    await loft.chat.addMessages(sessionId, [crypto.randomUUID()], [userMessage]);  // 2nd arg: correlator ids
    const result = await loft.chat.generate({ sessionId });  // loads stored history
    await result.messages.save();                            // persist the assistant reply
    const text = result.messages.llmResponse.topChoice.content
      .filter((p): p is Type.Entity.TextContent => p.type === 'text')
      .map(p => p.text).join('');
    res.json({ response: text });
  } catch (error) {
    if (error instanceof SessionNotFoundError) { res.status(404).json({ error: 'Session not found' }); return; }
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### NestJS

```typescript
import { LoftConstructor } from '@moc-global/loft';
import { Chat } from '@moc-global/loft-definitions';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

@Injectable()
export class LoftService implements OnModuleInit, OnModuleDestroy {
  private loftConstructor: LoftConstructor<Chat.ChatInterface> | null = null;
  private chat: Chat.ChatInterface | null = null;

  async onModuleInit() { /* build constructors, register strategies, this.chat = loft.chat */ }
  async onModuleDestroy() {
    // Waits for active operations, stops rate-limiter timers, shuts the tracer down
    await this.loftConstructor?.getInstance().shutdown();
    // then close the DB pool
  }
}

// main.ts — MUST call enableShutdownHooks
app.enableShutdownHooks();
```

### Serverless (AWS Lambda)

```typescript
// Module-level singleton for warm invocations
let initPromise: Promise<Awaited<ReturnType<typeof initializeLoft>>> | null = null;

function ensureInitialized() {
  if (!initPromise) {
    initPromise = initializeLoft().catch(err => { initPromise = null; throw err; });
  }
  return initPromise;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { loft } = await ensureInitialized();
  // Create ephemeral session, generate, delete session in a finally block so it is removed on errors too
  // Do NOT call shutdown() — container is reused
}
```

---

## Per-Storage-Backend Setup

### AWS S3

```typescript
import { ManifestManagerConstructor } from '@moc-global/loft';
import { AwsS3RepositoryConstructor } from '@moc-global/loft-aws-s3-repository';

const manifestManagerConstructor = new ManifestManagerConstructor(
  new AwsS3RepositoryConstructor({ region: 'us-east-1', bucketName: 'my-manifests' }),  // also: endpoint?, forcePathStyle?
  { manifestPath: 'manifests/manifest.json', errorPath: 'manifests/error.json', cacheExpirationTime: 3_600_000 }
);
```

### Google Cloud Storage

```typescript
import { GcpStorageRepositoryConstructor } from '@moc-global/loft-gcp-storage-repository';

new GcpStorageRepositoryConstructor({ bucketName: 'my-manifests', projectId: 'my-project' });  // also: apiEndpoint?
```

### Azure Blob Storage

```typescript
import { AzureBlobStorageRepositoryConstructor } from '@moc-global/loft-azure-blob-storage-repository';

new AzureBlobStorageRepositoryConstructor({
  containerName: 'loft-manifests', connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING!
});
```

---

## Adding Middleware

Register on `chatConstructor` **after** `new LoftConstructor(...)` but **before** `getInstance()`.

```typescript
import { BeforeGenerateMiddleware, Chat, ContextInterface, GenerateRequestParameters, StandardMiddleware, Type } from '@moc-global/loft-definitions';

// Input middleware
const inputLogger: StandardMiddleware<ContextInterface, GenerateRequestParameters> = async (ctx, payload, chain) => {
  console.log(`Processing ${payload.directMessages.length} messages`);
  chain.next();
  return payload;
};

// BeforeGenerate middleware (can prevent generation)
const validator: BeforeGenerateMiddleware<ContextInterface, GenerateRequestParameters> = async (ctx, payload, chain) => {
  if (someCondition) {
    chain.preventGeneration({ content: [{ type: 'text', text: 'Blocked' }], role: Type.LLM.UnifiedMessageRole.assistant });
    return payload;  // do NOT call chain.next()
  }
  chain.next();
  return payload;
};

// AfterGenerate middleware — payload is Chat.GenerateResultMessages
const logger: StandardMiddleware<ContextInterface, Chat.GenerateResultMessages> = async (ctx, payload, chain) => {
  console.log('Tokens:', payload.llmResponse.usage.totalTokens);
  chain.next();
  return payload;
};

chatConstructor.registerInputMiddleware('input-logger', inputLogger);
chatConstructor.registerBeforeGenerateMiddleware('validator', validator);
// Optional, experimental 3rd arg { transformsOutput: false }: the middleware does not change the reply text,
// so streamed text is not held back for it
chatConstructor.registerAfterGenerateMiddleware('response-logger', logger, { transformsOutput: false });
```

---

## Manifest File Structure

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
  "prompts": {},
  "aiTasks": {}
}
```

Both `manifestName` and `llmName` must exactly match what you pass to `createSession()` and `registerLlmStrategy()`.

---

## Session & Chat Usage

```typescript
import { Type } from '@moc-global/loft-definitions';

// Create session
const session = await loft.chat.createSession({
  currentLlmName: 'gpt-4o-mini',
  currentManifestName: 'my-assistant',
  ctx: {}
});

// Generate (single-turn with directMessages)
const result = await loft.chat.generate({
  sessionId: session.id,
  directMessages: [{
    sessionId: session.id,
    content: [{ type: 'text', text: 'Hello!' }],
    role: Type.LLM.UnifiedMessageRole.user,
    author: 'user',
    llmName: 'gpt-4o-mini',
    manifestName: 'my-assistant',
    ctx: {},
    llmIgnore: false
  }]
});

// Extract response text
const text = result.messages.llmResponse.topChoice.content
  .filter((p): p is Type.Entity.TextContent => p.type === 'text')
  .map(p => p.text).join('');
```

---

## Graceful Shutdown

```typescript
await loft.shutdown();  // waits for in-flight requests, stops strategies' rate-limiter timers, shuts the tracer down last
await pool.end();       // close DB pool
```

`ChatConfig.shutdownTimeout` (ms) bounds the wait; without it `shutdown()` waits as long as requests run. `loftConstructor.gracefulShutdown()` is deprecated — `loft.shutdown()` already flushes the tracer.

---

## Database Setup

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA IF NOT EXISTS loft_session;
CREATE SCHEMA IF NOT EXISTS loft_chat_history;
```

The migration CLIs read `DATABASE_URL`, the schema name and optional `DATABASE_SSL` from the environment or an env file (`--env <path>`, default `.env.loft-pg-migrations`):

```bash
export DATABASE_URL=postgresql://user:pass@localhost:5432/mydb
DATABASE_SESSION_SCHEMA_NAME=loft_session npx loft-session-pg-migrate to-latest
DATABASE_CHAT_HISTORY_SCHEMA_NAME=loft_chat_history npx loft-chat-history-pg-migrate to-latest
```

Commands: `up`, `down`, `to <migration-name>`, `to-latest`, `to-current-lib-version`. Schema names must be lower-case letters, digits and underscores (max 63), and the schema must already exist.

Programmatic alternative (used by the PGlite examples):

```typescript
import { runSessionPgMigrations } from '@moc-global/loft-session-pg-repository';
import { runChatHistoryPgMigrations } from '@moc-global/loft-chat-history-pg-repository';

await runSessionPgMigrations({ databaseUrl, direction: 'to-latest', schemaName: 'loft_session', libraryVersion: '3.0.0' }, pool);
await runChatHistoryPgMigrations({ databaseUrl, direction: 'to-latest', schemaName: 'loft_chat_history', libraryVersion: '3.0.0' }, pool);
```
