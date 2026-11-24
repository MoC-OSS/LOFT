# LOFT Setup Patterns

## Contents

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

Verified boilerplate for integrating `@moc-global/loft`. Every snippet confirmed against monorepo source.

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

const pool = new Pool({ host, port, user, password, database });

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
import { AzureOpenAiCallStrategy, AzureOpenAiLoftStrategy, OpenAiRequest, OpenAiResponse } from '@moc-global/loft-openai-strategy';

const callStrategy = new AzureOpenAiCallStrategy(
  {
    endpoint: 'https://my-resource.openai.azure.com',
    deploymentName: 'my-deployment',
    apiVersion: '2024-10-01-preview',
    auth: { type: 'api-key', apiKey: process.env.AZURE_OPENAI_API_KEY! }
    // Or: auth: { type: 'azure-ad' }  // uses DefaultAzureCredential
  },
  rateLimiter, tokenizer
);
```

### Anthropic

```typescript
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
import { GeminiCallStrategy, GeminiLoftStrategy, GeminiStrategyConfig } from '@moc-global/loft-gemini-strategy';
import { GeminiRequest, GeminiResponse } from '@moc-global/loft-gemini-strategy';

// API Key mode (Google AI Studio)
const config: GeminiStrategyConfig = { mode: 'apikey', apiKey: process.env.GOOGLE_API_KEY! };

// Vertex AI mode (GCP)
const config: GeminiStrategyConfig = { mode: 'vertexai', project: 'my-gcp-project', location: 'us-central1' };

const callStrategy = new GeminiCallStrategy(config, rateLimiter, tokenizer);
```

---

## Per-Framework Patterns

### Express (basic — ephemeral sessions)

```typescript
import 'reflect-metadata';
import { Type } from '@moc-global/loft-definitions';
import express from 'express';

const app = express();
app.use(express.json());

app.post('/chat', async (req, res) => {
  const { message } = req.body;
  const session = await loft.chat.createSession({
    currentLlmName: 'gpt-4o-mini', currentManifestName: 'my-assistant', ctx: {}
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
  const correlatorId = crypto.randomUUID();
  await loft.chat.addMessages(sessionId, [correlatorId], [userMessage]);
  const result = await loft.chat.generate({ sessionId });
  await result.messages.save();
  res.json({ response: extractText(result) });
});
```

### NestJS

```typescript
@Injectable()
export class LoftService implements OnModuleInit, OnModuleDestroy {
  private chat: Chat.ChatInterface | null = null;

  async onModuleInit() { /* initialize LOFT, register strategies */ }
  async onModuleDestroy() { await this.chat?.shutdown(); }
}

// main.ts — MUST call enableShutdownHooks
app.enableShutdownHooks();
```

### Serverless (AWS Lambda)

```typescript
// Module-level singleton for warm invocations
let initPromise: Promise<...> | null = null;

function ensureInitialized() {
  if (!initPromise) {
    initPromise = doInitialize().catch(err => { initPromise = null; throw err; });
  }
  return initPromise;
}

export async function handler(event) {
  const { loft } = await ensureInitialized();
  // Create ephemeral session, generate, delete session
  // Do NOT call shutdown() — container is reused
}
```

---

## Per-Storage-Backend Setup

### AWS S3

```typescript
import { AwsS3RepositoryConstructor } from '@moc-global/loft-aws-s3-repository';

const manifestManagerConstructor = new ManifestManagerConstructor(
  new AwsS3RepositoryConstructor({ region: 'us-east-1', bucketName: 'my-manifests' }),
  { manifestPath: 'manifests/manifest.json', errorPath: 'manifests/error.json', cacheExpirationTime: 3_600_000 }
);
```

### Google Cloud Storage

```typescript
import { GcpStorageRepositoryConstructor } from '@moc-global/loft-gcp-storage-repository';

new GcpStorageRepositoryConstructor({ bucketName: 'my-manifests', projectId: 'my-project' });
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
import { BeforeGenerateMiddleware, ContextInterface, GenerateRequestParameters, StandardMiddleware, Strategy, Type } from '@moc-global/loft-definitions';

// Input middleware
const inputLogger: StandardMiddleware<ContextInterface, GenerateRequestParameters> = async (ctx, payload, chain) => {
  console.log(`Processing ${payload.directMessages.length} messages`);
  await chain.next();
  return payload;
};

// BeforeGenerate middleware (can prevent generation)
const validator: BeforeGenerateMiddleware<ContextInterface, GenerateRequestParameters> = async (ctx, payload, chain) => {
  if (someCondition) {
    chain.preventGeneration({ content: [{ type: 'text', text: 'Blocked' }], role: Type.LLM.UnifiedMessageRole.assistant });
    return payload;  // do NOT call chain.next()
  }
  await chain.next();
  return payload;
};

// AfterGenerate middleware
const logger: StandardMiddleware<ContextInterface, Strategy.LLM.UnifiedLLMResponse> = async (ctx, payload, chain) => {
  console.log('Tokens:', payload.usage.totalTokens);
  await chain.next();
  return payload;
};

chatConstructor.registerInputMiddleware('input-logger', inputLogger);
chatConstructor.registerBeforeGenerateMiddleware('validator', validator);
chatConstructor.registerAfterGenerateMiddleware('response-logger', logger);
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
    manifestName: 'my-assistant'
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
await loft.shutdown();                    // drains in-flight operations (delegates to chat.shutdown())
await loftConstructor.gracefulShutdown(); // flushes tracer (Langfuse)
await pool.end();                        // close DB pool
```

---

## Database Setup

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA IF NOT EXISTS loft_session;
CREATE SCHEMA IF NOT EXISTS loft_chat_history;
```

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/mydb
DATABASE_SESSION_SCHEMA_NAME=loft_session
DATABASE_CHAT_HISTORY_SCHEMA_NAME=loft_chat_history

npx loft-session-pg-migrate to-latest --env .env
npx loft-chat-history-pg-migrate to-latest --env .env
```
