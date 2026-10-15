import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['./src/**/*.ts'],
  format: ['esm', 'cjs'],
  splitting: false,
  sourcemap: true,
  outDir: 'lib',
  clean: true,
  dts: false,
  external: []
});