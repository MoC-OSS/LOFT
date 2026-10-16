# How to Configure Manifests

Manifests separate prompt engineering from application code. They define system messages and model presets as JSON files, loaded at runtime by LOFT's ManifestManager.

## Manifest File Structure

A manifest file has three top-level sections:

```json
{
  "llmManifests": { },
  "prompts": { },
  "aiTasks": { }
}
```

### llmManifests

The primary section — defines system messages and model presets for chat generation:

```json
{
  "llmManifests": {
    "customer-support": {
      "gpt-4o-mini": {
        "systemMessage": "You are a helpful customer support agent for Acme Corp. Be concise and professional.",
        "modelPreset": {
          "model": "gpt-4o-mini",
          "temperature": 0.5,
          "max_tokens": 500
        }
      },
      "claude-sonnet": {
        "systemMessage": "You are a helpful customer support agent for Acme Corp. Be concise and professional.",
        "modelPreset": {
          "model": "claude-sonnet-5-5",
          "max_tokens": 500
        }
      }
    },
    "code-reviewer": {
      "gpt-4o": {
        "systemMessage": "You are an expert code reviewer. Focus on bugs, security, and maintainability.",
        "modelPreset": {
          "model": "gpt-4o",
          "temperature": 0.2,
          "max_tokens": 2000
        }
      }
    }
  }
}
```

**Structure:** `llmManifests[manifestName][llmName]` → `{ systemMessage, modelPreset }`

- **`manifestName`** — A logical name for your bot/agent (e.g., `"customer-support"`, `"code-reviewer"`). Referenced in `createSession({ currentManifestName: '...' })`.
- **`llmName`** — Must match a registered LLM strategy name. Referenced in `createSession({ currentLlmName: '...' })`.
- **`systemMessage`** — The system prompt sent to the LLM.
- **`modelPreset`** — Provider-specific model configuration. Validated at strategy registration time against the strategy's Zod schema.

### prompts

Standalone text prompts (not tied to a generate call):

```json
{
  "prompts": {
    "summarize": {
      "gpt-4o-mini": "Summarize the following text in 3 bullet points:"
    }
  }
}
```

Each value is the prompt text for one LLM name. Middleware, prompt computers and tool interceptors read it with `await context.getPrompt('summarize', 'gpt-4o-mini')`, which runs the matching prompt computer first.

### aiTasks

Similar to llmManifests but for one-off AI tasks (not conversation-based):

```json
{
  "aiTasks": {
    "classify-intent": {
      "gpt-4o-mini": {
        "systemMessage": "Classify the user's intent into one of: question, complaint, request, feedback",
        "modelPreset": {
          "model": "gpt-4o-mini",
          "temperature": 0,
          "max_tokens": 50
        }
      }
    }
  }
}
```

Retrieved via `llmManager.aiTask(ctx, llmName, manifestName, content)`.

## Storage Backends

The storage backends listed below are used **exclusively for manifest file storage** (system prompts, model presets, AI task definitions). They are not related to session or chat history storage, which uses separate repository interfaces. See [Chat Persistence](./chat-persistence.md) for session and history storage.

### Local Filesystem (development)

The simplest option — reads JSON files from disk relative to `process.cwd()`:

```typescript
import { FsRepositoryConstructor, ManifestManagerConstructor } from '@moc-global/loft';

const manifestRepo = new FsRepositoryConstructor();
const manifestManager = new ManifestManagerConstructor(manifestRepo, {
  manifestPath: 'manifest/manifest.json',
  errorPath: 'manifest/errors/error.json',
  cacheExpirationTime: 60000  // 1 minute cache
});
```

Create the file at `<project-root>/manifest/manifest.json`.

### AWS S3 (production)

```typescript
import { AwsS3RepositoryConstructor } from '@moc-global/loft-aws-s3-repository';

const manifestRepo = new AwsS3RepositoryConstructor({
  region: 'us-east-1',
  bucketName: 'my-loft-manifests'
});

const manifestManager = new ManifestManagerConstructor(manifestRepo, {
  manifestPath: 'manifests/production/manifest.json',  // S3 key path
  errorPath: 'manifests/production/errors/error.json',
  cacheExpirationTime: 3600000  // 1 hour cache in production
});
```

### Google Cloud Storage

```typescript
import { GcpStorageRepositoryConstructor } from '@moc-global/loft-gcp-storage-repository';

const manifestRepo = new GcpStorageRepositoryConstructor({
  bucketName: 'my-loft-manifests',
  projectId: 'my-gcp-project'
});
```

### Azure Blob Storage

```typescript
import { AzureBlobStorageRepositoryConstructor } from '@moc-global/loft-azure-blob-storage-repository';

const manifestRepo = new AzureBlobStorageRepositoryConstructor({
  containerName: 'loft-manifests',
  connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING!
});
```

## Caching

ManifestManager caches loaded manifests in memory. The cache TTL is set via `cacheExpirationTime`:

- **Development:** Use short TTL (e.g., `60000` = 1 minute) so changes are picked up quickly
- **Production:** Use longer TTL (e.g., `3600000` = 1 hour) to reduce storage reads

To force a cache refresh:

```typescript
await loftConstructor.validateManifest();  // Reloads and validates; rejects when the manifests are invalid
```

## Prompt Computers

For dynamic system messages, register **prompt computers** that modify manifests at runtime. This is useful when the system prompt needs session-specific data.

### GM Computer (GenerateManifest)

Runs before every `generate()` call to modify the system message:

```typescript
loftConstructor.registerGMComputer(
  'customer-support',    // manifestName
  'gpt-4o-mini',         // llmName
  async (context, prompt, modelPreset) => {
    // context is the full ContextInterface
    // prompt is a Prompt object: { name: string; content: string }
    const userName = context.session.ctx.userName || 'User';
    return `${prompt.content}\n\nYou are speaking with ${userName}.`;
  }
);
```

The computer receives the original `systemMessage` from the manifest and returns a modified string.

### ATM Computer (AiTaskManifest)

Same pattern, but runs before `aiTask()` calls. See the [AI Tasks guide](./ai-tasks.md) for full usage details.

```typescript
loftConstructor.registerATMComputer(
  'classify-intent',
  'gpt-4o-mini',
  async (context, prompt, modelPreset) => {
    return prompt.content + '\n\nRespond with JSON only.';
  }
);
```

### Prompt Computer

Runs when retrieving standalone prompts:

```typescript
loftConstructor.registerPromptComputer(
  'summarize',
  'gpt-4o-mini',
  async (context, prompt, modelPreset) => {
    // prompt is a Prompt object: { name: string; content: string }
    return prompt.content + `\n\nKeep the summary under ${context.session.ctx.maxWords || 100} words.`;
  }
);
```

Prompt computers receive an empty `modelPreset`; GM and ATM computers receive the manifest's preset.

### Errors and state in computers

A computer that throws fails the request: `generate()`, `aiTask()` or `getPrompt()` rejects with its error. If a computer depends on something that can fail, catch the error and return `prompt.content` unchanged.

`prompt.name` is the manifest, AI task or prompt name the computer was registered for. A computer runs on every call; LOFT does not cache its result. To keep data between calls, store it in the session with `await context.session.update({ ctx: { ...context.session.ctx, key: value } })`; setting `context.session.ctx` alone is lost when the request ends.

## Model Preset Validation

When you register an LLM strategy, its `generateModelPresetSchema()` Zod schema is registered with ManifestManager. When a manifest is loaded, the `modelPreset` is validated against this schema.

If validation fails, LOFT throws at manifest load time — not at `generate()` time. This gives early feedback about misconfigured manifests.

### Provider-Specific Presets

Each provider accepts different `modelPreset` fields:

**OpenAI:**
```json
{
  "model": "gpt-4o-mini",
  "temperature": 0.7,
  "max_tokens": 1000,
  "top_p": 1,
  "frequency_penalty": 0,
  "presence_penalty": 0
}
```

**Anthropic:**
```json
{
  "model": "claude-sonnet-5-5",
  "max_tokens": 1000
}
```

`max_tokens` is required. Current Claude models reject `temperature`, `top_p` and `top_k` with a 400 error, so leave them out. Unless you turn it off, current Claude models think before they answer, and the thinking counts against `max_tokens`; Claude Sonnet 5.5 turns it off with `"thinking": { "type": "between_tools" }`, and Claude Haiku 5.5 with `"thinking": { "type": "disabled" }`. With a small limit (a few hundred tokens) the model can use all of it on thinking and return an empty answer with `usage.finishReason` set to `max_tokens`; give it several thousand.

The exact allowed fields depend on each strategy's validation schema. Check the strategy package's `ValidatingSchemas` export for details.

## Environment-Based Configuration

A common pattern is to use different storage backends per environment:

```typescript
let manifestRepo;
if (process.env.NODE_ENV === 'production') {
  manifestRepo = new AwsS3RepositoryConstructor({
    region: process.env.AWS_REGION!,
    bucketName: process.env.MANIFEST_BUCKET!
  });
} else {
  manifestRepo = new FsRepositoryConstructor();
}

const manifestManager = new ManifestManagerConstructor(manifestRepo, {
  manifestPath: process.env.MANIFEST_PATH || 'manifest/manifest.json',
  errorPath: process.env.MANIFEST_ERROR_PATH || 'manifest/errors/error.json',
  cacheExpirationTime: process.env.NODE_ENV === 'production' ? 3600000 : 60000
});
```
