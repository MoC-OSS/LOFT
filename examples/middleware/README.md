# Middleware recipes and guards

Two kinds of middleware:

- **One-file recipes** in [`src/recipes/`](./src/recipes/). Copy one into your application and change it as you need.
- **The guard package** `@moc-global/loft-middleware` (PII redaction and prompt-injection detection), shown in an offline demo. Use the package rather than copying it, so that its fixes reach you.

## Recipes

| Recipe | Stage | What it does |
|---|---|---|
| [`countMessages`](./src/recipes/countMessages.ts) | Input | Logs how many messages a request carries, never their text |
| [`tagChannel`](./src/recipes/tagChannel.ts) | Input | Records the channel in `message.ctx`, which is stored with the message |
| [`blockTopics`](./src/recipes/blockTopics.ts) | BeforeGenerate | Answers with a fixed reply, without calling the model, when the newest message mentions a blocked topic |

## Guard demo

[`src/demo.ts`](./src/demo.ts) runs two turns through a guarded chat with a scripted model, in-memory storage and an MCP server in the same process. It needs no API key and no database.

```bash
pnpm install
pnpm --filter @moc-global/example-middleware... build
cd examples/middleware
pnpm start
```

The first turn has an e-mail address in the message and a card number in the CRM tool's output. The model sees placeholders, and the history and the traces keep only the placeholders.

The second turn is an injection attempt, added with `addMessages()`. It is quarantined, the model is not called, and the reply is the fixed block message.

`pnpm test` checks the same in [`src/demo.test.ts`](./src/demo.test.ts). It also runs [`src/guards.e2e.test.ts`](./src/guards.e2e.test.ts), which installs the guards on the PostgreSQL session and chat-history repositories (on PGlite, in the same process, no Docker) and checks streamed `generate()` calls: no personal data in the model calls, the stored rows, the traces or the events; the quarantined message and its `ctx.loftGuard` finding as PostgreSQL stores them; `onUserFlag: 'throw'`; and injections in MCP tool outputs and descriptions.

See the [Guard middleware guide](../../docs/guides/guard-middleware.md) for the options, the trade-offs and what the guards do not protect against.
