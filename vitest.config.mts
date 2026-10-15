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
      // Floors at the lower of Node 22 and 24 coverage on 2026-10-09 (V8 counts differ slightly by Node version).
      // Raise them as tests are added, never lower them.
      thresholds: {
        'packages/loft/src/**': { lines: 71, branches: 83, functions: 69, statements: 71 },
        'packages/loft-agents/src/**': { lines: 95, branches: 90, functions: 93, statements: 95 },
        'packages/loft-definitions/src/**': { lines: 72, branches: 86, functions: 49, statements: 72 },
        'packages/loft-openai-strategy/src/**': { lines: 27, branches: 50, functions: 24, statements: 27 },
        'packages/loft-session-pg-repository/src/**': { lines: 14, branches: 57, functions: 54, statements: 14 }
      }
    }
  }
});
