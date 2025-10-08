import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'app',
    include: ['tests/app/**/*.{test,spec}.{ts,js}'],
    environment: 'node',
    globals: true,
    exclude: ['node_modules/**', 'dist/**'],
    setupFiles: [],
  },
});
