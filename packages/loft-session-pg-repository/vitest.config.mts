import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  },
  resolve: {
    alias: {
      '@moc-global/loft-definitions': path.resolve(__dirname, '../loft-definitions')
    }
  }
});