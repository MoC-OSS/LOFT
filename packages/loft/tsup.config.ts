import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['./src/index.ts'],
  format: ['esm', 'cjs'],
  splitting: false,
  sourcemap: true,
  outDir: 'lib',
  clean: true,
  // LangfuseTracer loads the optional langfuse peer with require in the CommonJS build and from import.meta.url
  // in the ES module build; each build keeps only its own branch
  esbuildOptions(options, { format }) {
    options.define = { ...options.define, __LOFT_ESM_BUILD__: String(format === 'esm') };
    // The CommonJS build never runs the import.meta branch
    if (format === 'cjs') options.define['import.meta.url'] = 'undefined';
  },
  dts: false,
  external: []
});
