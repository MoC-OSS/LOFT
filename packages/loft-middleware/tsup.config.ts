import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: './src/index.ts',
    'pii/index': './src/pii/index.ts',
    'injection/index': './src/injection/index.ts'
  },
  format: ['esm', 'cjs'],
  splitting: false,
  sourcemap: true,
  outDir: 'lib',
  clean: true,
  dts: false,
  external: []
});
