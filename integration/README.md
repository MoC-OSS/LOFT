# LOFT integration tests

End-to-end tests of the LOFT packages: real constructors and middleware, PostgreSQL storage and in-memory MCP servers. They need no keys and no Docker: each test file starts its own in-process [PGlite](https://pglite.dev) database, and a scripted LLM (`ScriptedLLMStrategy` from `@moc-global/loft-test-suite`) answers instead of a provider.

```bash
pnpm build-packages              # the esm and cjs runs test the built packages
pnpm test:integration            # against the TypeScript sources
pnpm test:integration:esm        # against lib/index.mjs
pnpm test:integration:cjs        # against lib/index.js
```

Every setting is optional. Copy `.env.test.example` to `.env.test` to run against a real PostgreSQL (`LOFT_TEST_DATABASE_URL`) or to turn on the live tests (`*.live.test.ts`), which call the providers and skip themselves without keys.

See [Testing](../docs/contributing/testing.md#integration-tests) for the settings, the live tests and how to write an offline test.
