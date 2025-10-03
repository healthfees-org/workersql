import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Note: Multi-project configuration is defined in vitest.workspace.ts
// This base config is kept minimal to satisfy tooling that looks for vitest.config.ts
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@/types': resolve(__dirname, './src/types'),
      '@/services': resolve(__dirname, './src/services'),
      '@/utils': resolve(__dirname, './src/utils'),
    },
  },
  test: {
    name: 'node',
    environment: 'node',
    globals: true,
    include: ['tests/**/*.{test,spec}.{js,ts}'],
    exclude: ['tests/integration/**', 'node_modules/**', 'dist/**', 'sdk/**', 'tests/e2e/**'],
    setupFiles: ['tests/vitest.setup.ts'],
    testTimeout: 10000,
    hookTimeout: 30000,
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'coverage/**',
        'tests/**',
        'sdk/**',
        '**/*.d.ts',
        '**/*.config.{js,ts}',
        'vitest.*.ts',
        'wrangler.toml*',
      ],
      include: ['src/**/*.{ts,js}'],
      all: true,
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
  },
});
