import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts'],
    exclude: ['**/lib/**', '**/node_modules/**', '**/integration/**', '**/*integration.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.ts'],
      // Test helpers are not shipped code
      exclude: ['**/__tests__/**', 'packages/loft-test-suite/**', 'packages/loft-pglite/**'],
      // Floors at the lowest of Node 22.12, 22, 24 and 26 coverage on 2026-10-19, measured with Vitest 4, whose V8
      // coverage maps to the source and counts only real branches (Vitest 3 also counted each function as a branch).
      // Raise them as tests are added, never lower them.
      thresholds: {
        // Measured on 2026-10-22 with the chat streaming tests, locally on one Node version (25.9), and set about one
        // point below the measured values to leave room for other Node versions
        'packages/loft/src/**': { lines: 92, branches: 84, functions: 89, statements: 91 },
        // Measured on 2026-10-22 with the streaming tests, locally on one Node version (25.9), and set about one point
        // below the measured values to leave room for other Node versions
        'packages/loft-llm-call-manager/src/**': { lines: 97, branches: 95, functions: 100, statements: 97 },
        'packages/loft-agents/src/**': { lines: 98, branches: 88, functions: 95, statements: 97 },
        'packages/loft-definitions/src/**': { lines: 77, branches: 79, functions: 64, statements: 77 },
        // Measured on 2026-10-22 with the OpenAI stream fixtures, locally on one Node version (25.9), and set about one
        // point below the measured values to leave room for other Node versions
        'packages/loft-openai-strategy/src/**': { lines: 72, branches: 79, functions: 73, statements: 74 },
        'packages/loft-session-pg-repository/src/**': { lines: 85, branches: 57, functions: 87, statements: 86 },
        // Measured on 2026-10-20, with the PGlite contract tests
        'packages/loft-chat-history-pg-repository/src/**': { lines: 78, branches: 33, functions: 80, statements: 79 },
        'packages/loft-kysely-pg-migrator/src/**': { lines: 43, branches: 48, functions: 50, statements: 43 },
        // Measured on 2026-10-22 with the Anthropic stream fixtures, locally on one Node version (25.9), about one point
        // below the measured values
        'packages/loft-anthropic-strategy/src/**': { lines: 77, branches: 69, functions: 79, statements: 77 },
        // Measured on 2026-10-22 with the Gemini stream fixtures and the tool schema tests, locally on one Node version
        // (25.9), about one point below
        'packages/loft-gemini-strategy/src/**': { lines: 89, branches: 88, functions: 90, statements: 90 },
        // Measured on 2026-10-22 locally on one Node version (25.9), about one point below the measured values
        'packages/loft-openai-strategy/src/adapters/**': { lines: 78, branches: 63, functions: 100, statements: 79 },
        'packages/loft-anthropic-strategy/src/adapters/**': { lines: 83, branches: 73, functions: 94, statements: 84 },
        'packages/loft-gemini-strategy/src/gemini/adapters/**': {
          lines: 95,
          branches: 89,
          functions: 100,
          statements: 95
        }
      }
    }
  }
});
