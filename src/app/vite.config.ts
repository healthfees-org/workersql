import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig({
  plugins: [svelte()],
  root: '.',
  base: '/',
  build: {
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
  server: {
    port: 8787,
    strictPort: true,
    proxy: {
      '/metrics': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/sql': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      $lib: resolve(__dirname, './src/lib'),
    },
  },
});
