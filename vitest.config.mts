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
        'packages/loft/src/**': { lines: 79, branches: 76, functions: 72, statements: 79 },
        'packages/loft-agents/src/**': { lines: 98, branches: 88, functions: 95, statements: 97 },
        'packages/loft-definitions/src/**': { lines: 77, branches: 79, functions: 64, statements: 77 },
        'packages/loft-openai-strategy/src/**': { lines: 43, branches: 32, functions: 47, statements: 44 },
        'packages/loft-session-pg-repository/src/**': { lines: 18, branches: 0, functions: 20, statements: 18 }
      }
    }
  }
});
