import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.vitest.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'sdk/**'],
  },
});
