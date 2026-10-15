# Environment Variables Reference

LOFT takes its configuration from constructor arguments. It reads two environment variables, both as fallbacks: `LOFT_MCP_MAX_CALLS_PER_GENERATE` for `ChatConfig.mcp.maxCallsPerGenerate` (default 10), and `LOFT_AGENTS_MAX_DEPTH` for the orchestrator's depth limit when `setMaxDepth()` is not called (default 10). The rest of this page lists the variables the test suites and migration CLIs read.

## Integration Test Variables

`integration/src/__tests__/config.ts` reads these from the environment or from `integration/.env.test` (template: `integration/.env.test.example`). All are optional: without them the offline tests run on PGlite and the live tests are skipped.

### General

| Variable | Default | Description |
|----------|---------|-------------|
| `LOFT_LOG_LEVEL` | `FATAL` | A `LogLevel` key: `NONE`, `FATAL`, `ERROR`, `WARN`, `INFO`, `DEBUG`, `TRACE` |
| `LOFT_TEST_DATABASE_URL` | none (PGlite) | A PostgreSQL server to test against; each test file creates and drops a database of its own (needs CREATEDB) |
| `LOFT_SESSION_DATABASE_SCHEMA_NAME` | `loft_session` | Session schema |
| `LOFT_CHAT_HISTORY_DATABASE_SCHEMA_NAME` | `loft_chat_history` | Chat history schema |

### Manifest Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LOFT_MANIFEST_PATH` | `manifest/manifest.json` | Manifest file, relative to `integration/` |
| `LOFT_MANIFEST_ERROR_PATH` | `manifest/errors/error.json` | Where validation errors are written |
| `LOFT_MANIFEST_CACHE_EXPIRATION` | `60000` | Cache time in milliseconds |

### Live Provider Strategies

Used by the strategies of the live tests, whatever the provider (the `OPENAI` in the names is historical).

| Variable | Default | Description |
|----------|---------|-------------|
| `LOFT_OPENAI_CALL_STRATEGY_NEW_TOKENS_PER_SECOND` | `50000` | Token budget refill per second |
| `LOFT_OPENAI_CALL_STRATEGY_NEW_REQUESTS_PER_SECOND` | `100` | Request budget refill per second |
| `LOFT_OPENAI_CALL_STRATEGY_MAX_REQUESTS` | `500` | Request budget size |
| `LOFT_OPENAI_CALL_STRATEGY_MAX_TOKENS` | `2000000` | Token budget size |
| `LOFT_OPENAI_CALL_STRATEGY_MAX_AWAIT_SECONDS` | `300` | Longest wait for budget |
| `LOFT_OPENAI_CALL_MANAGER_HIGH_PRIORITY_TASKS_LIMIT` | `10` | Most calls waiting in the queue |
| `LOFT_OPENAI_CALL_MANAGER_RETRY_DELAY` | `1000` | Milliseconds between attempts |
| `LOFT_OPENAI_CALL_MANAGER_RETRY_ATTEMPTS_LIMIT` | `3` | Attempts per call |

### Live Test Keys

| Variable | Turns on |
|----------|----------|
| `LOFT_OPENAI_API_KEY` | The OpenAI half of `loft.tool-calls.live.test.ts` |
| `LOFT_ANTHROPIC_API_KEY` | The Anthropic half of `loft.tool-calls.live.test.ts` |
| `LOFT_GEMINI_VERTEX_PROJECT` | `loft.gemini.live.test.ts` (with Application Default Credentials; `LOFT_GEMINI_VERTEX_LOCATION` defaults to `us-central1`) |
| `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_HOST` | `loft.langfuse.live.test.ts` |

## Package-Level Test Variables

Individual packages that have Docker-based integration tests use a different naming convention:

### Session / Chat History Repository Tests

| Variable | Example | Used by |
|----------|---------|---------|
| `DATABASE_NAME` | `loft_db` | Session + ChatHistory repo tests |
| `DATABASE_HOST` | `localhost` | Session + ChatHistory repo tests |
| `DATABASE_USER` | `postgres` | Session + ChatHistory repo tests |
| `DATABASE_PASSWORD` | `postgres` | Session + ChatHistory repo tests |
| `DATABASE_PORT` | `5432` | Session + ChatHistory repo tests |
| `DATABASE_SESSION_SCHEMA_NAME` | `loft_session` | Session repo tests |
| `DATABASE_CHAT_HISTORY_SCHEMA_NAME` | `loft_chat_history` | ChatHistory repo tests |
| `POSTGRES_CONTAINER_NAME` | `test-postgres` | Docker container name |
| `DATABASE_POSTGRES_IMAGE` | `postgres:16-alpine` | Docker image |

### Cloud Storage Tests

| Variable | Example | Used by |
|----------|---------|---------|
| `S3_REGION` | `us-east-1` | S3 repo tests |
| `S3_BUCKET_NAME` | `test-bucket` | S3 repo tests |
| `S3_ENDPOINT` | `http://localhost:4566` | S3 (LocalStack) |
| `GCP_BUCKET` | `test-bucket` | GCS repo tests |
| `GCP_API_ENDPOINT` | `http://localhost:8080` | GCS (fake-gcs-server) |
| `GCP_API_PROJECT_ID` | `test-project` | GCS repo tests |
| `AZURE_BLOB_STORAGE_CONTAINER_NAME` | `test-container` | Azure Blob tests |
| `AZURE_BLOB_STORAGE_CONNECTION_STRING` | `DefaultEndpointsProtocol=...` | Azure Blob (Azurite) |

### SQS Queue Tests

| Variable | Example | Used by |
|----------|---------|---------|
| `SQS_ENDPOINT` | `http://127.0.0.1:4566` | SQS repo tests (LocalStack) |
| `SQS_REGION` | `us-east-1` | SQS repo tests |
| `QUEUE_NAME` | `test-queue` | SQS repo tests |
| `QUEUE_URL` | `http://127.0.0.1:4566/000000000000/test-queue` | SQS repo tests |

## Database Migration Variables

The CLI migration tools (`loft-session-pg-migrate`, `loft-chat-history-pg-migrate`) read from `.env` files:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Full PostgreSQL connection string (e.g., `postgresql://user:pass@localhost:5432/dbname`) |
| `DATABASE_SESSION_SCHEMA_NAME` | Schema name for session migrations |
| `DATABASE_CHAT_HISTORY_SCHEMA_NAME` | Schema name for chat history migrations |

## Notes

- **`.env.test` files are not committed**; `integration/.env.test.example` is the template.
- **Variables are strings**; the test config converts numbers with `z.coerce.number()`.
