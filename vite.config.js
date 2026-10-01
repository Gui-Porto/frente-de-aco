import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'esnext', chunkSizeWarningLimit: 4000 },
  esbuild: { target: 'esnext' },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
});
