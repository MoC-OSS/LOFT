# express-focus-basic — Pizza Order Bot

A minimal example demonstrating **LOFT Focus** for structured data collection across multi-turn conversations. No agents, no orchestrator — just `chat.generate()` with Focus tools auto-injected.

> **Not for production.** This example has no authentication or authorization and uses demo settings. Use it to learn LOFT, not as a template for a deployed service: add authentication, access checks on sessions, rate limiting and your own error handling first.

## Data Flow

```
User message
  |
  v
chat.generate({ sessionId, directMessages: [userMsg] })
  |
  ├── BaseLoftChat reads session.focusAgent = 'pizza-order'
  ├── resolveFocusContext() injects prompt + tools
  ├── LLM calls update_pizza-order_focus({ field: value, ... })
  ├── FocusStateStore persists values
  ├── focusStatus returned: { filled, missing, ready }
  |
  v
JSON response with text + focusStatus
```

## Focus Fields

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| pizza_type | ENUM [margherita, pepperoni, hawaiian, veggie] | yes | — |
| size | ENUM [small, medium, large] | yes | — |
| quantity | NUMBER | yes | 1-10 |
| delivery_address | STRING | yes | — |
| payment_method | ENUM [card, cash, online] | yes | — |
| special_instructions | STRING | no | — |

## Quick Start

```bash
# 1. Start Docker PostgreSQL (from repo root)
docker compose -f examples/docker-compose.yml up -d

# 2. Install dependencies (from repo root)
pnpm install

# 3. Build the example and all its LOFT dependencies (from repo root)
turbo build --filter=@moc-global/example-express-focus-basic...

# 4. Configure environment
cd examples/express-focus-basic
cp .env.example .env
# Edit .env — set ANTHROPIC_API_KEY

# 5. Run database migrations
pnpm migrate

# 6. Start the server
pnpm dev

# 7. Run the demo (in another terminal)
./test-chat.sh
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/sessions` | Create a new session with Focus |
| POST | `/api/chat` | Send a message `{ sessionId, message }` |
| GET | `/api/sessions/:id/history` | Get conversation history |

## Project Structure

```
examples/express-focus-basic/
├── manifest/manifest.json       # Single "pizza-order" LLM manifest
├── src/
│   ├── config.ts                # Zod env validation
│   ├── database.ts              # PG pool
│   ├── index.ts                 # Express app entry
│   ├── migrate.ts               # Database migrations (pnpm migrate)
│   ├── routes.ts                # API routes
│   └── loft/
│       ├── setup.ts             # LOFT init + registerFocus
│       ├── focus-config.ts      # Pizza order Focus definition
│       ├── chat.ts              # sendMessage via direct chat.generate()
│       └── session.ts           # createSession with focusAgent
├── .env.example
├── test-chat.sh                 # 3-turn demo script
└── README.md
```

## Key Difference from express-agents

This example uses **no `@moc-global/loft-agents` dependency**. Focus is a core LOFT feature — `chat.generate()` automatically injects Focus tools when the session has `focusAgent` set. When all required fields are collected, `focusStatus.ready` becomes `true` and `session.focusAgent` is auto-nullified.
