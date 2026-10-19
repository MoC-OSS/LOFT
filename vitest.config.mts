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
        'packages/loft/src/**': { lines: 88, branches: 78, functions: 86, statements: 87 },
        'packages/loft-llm-call-manager/src/**': { lines: 96, branches: 89, functions: 100, statements: 96 },
        'packages/loft-agents/src/**': { lines: 98, branches: 88, functions: 95, statements: 97 },
        'packages/loft-definitions/src/**': { lines: 77, branches: 79, functions: 64, statements: 77 },
        'packages/loft-openai-strategy/src/**': { lines: 48, branches: 42, functions: 50, statements: 48 },
        'packages/loft-session-pg-repository/src/**': { lines: 85, branches: 57, functions: 87, statements: 86 },
        // Measured on 2026-10-20, with the PGlite contract tests
        'packages/loft-chat-history-pg-repository/src/**': { lines: 78, branches: 33, functions: 80, statements: 79 },
        'packages/loft-kysely-pg-migrator/src/**': { lines: 43, branches: 48, functions: 50, statements: 43 },
        // Measured on 2026-10-20, with the shared adapter fixtures
        'packages/loft-anthropic-strategy/src/**': { lines: 70, branches: 63, functions: 72, statements: 71 },
        'packages/loft-gemini-strategy/src/**': { lines: 73, branches: 71, functions: 73, statements: 73 },
        'packages/loft-openai-strategy/src/adapters/**': { lines: 76, branches: 56, functions: 100, statements: 77 },
        'packages/loft-anthropic-strategy/src/adapters/**': { lines: 83, branches: 73, functions: 94, statements: 84 },
        'packages/loft-gemini-strategy/src/gemini/adapters/**': { lines: 93, branches: 79, functions: 100, statements: 92 }
      }
    }
  }
});
