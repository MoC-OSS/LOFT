import { defineConfig } from 'vite';

export default defineConfig({
  // Specify the root of your project
  root: './',
  // Define the build options
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'esnext',
    rollupOptions: {
      output: {
        format: 'cjs'
      }
    }
  },
  // Add any plugins you need here
  plugins: []
});
