import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['./src/index.ts'],
    format: ['esm', 'cjs'],
    // Defines __dirname in the ES module build, which runMigrations uses to find lib/migrations
    shims: true,
    splitting: false,
    sourcemap: true,
    outDir: 'lib',
    clean: true,
    dts: false,
    external: []
  },
  {
    // Migrations and CLI binary must be CJS-only because:
    // 1. Kysely's FileMigrationProvider uses require() which cannot load ESM modules (.mjs files)
    // 2. Node.js shebang scripts work best with CommonJS
    entry: ['./src/migrations/**/*.ts', './src/bin/**/*.ts'],
    format: ['cjs'],
    splitting: false,
    sourcemap: true,
    outDir: 'lib',
    clean: false,
    dts: false,
    noExternal: ['@moc-global/loft-kysely-pg-migrator']
  }
]);
