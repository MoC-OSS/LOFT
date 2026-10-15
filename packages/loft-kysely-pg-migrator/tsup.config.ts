import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/**/*.ts', '!src/**/__tests__/**'],
  format: ['cjs', 'esm'],
  outDir: 'lib',
  dts: false, // We generate types separately
  sourcemap: true,
  clean: true,
  splitting: false,
  minify: false,
  target: 'es2022'
});
