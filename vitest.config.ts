import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    // Test environment configuration
    environment: 'node',

    // Include patterns for test files
    include: ['tests/**/*.{test,spec}.{js,ts}'],

    // Exclude patterns
    exclude: [
      'node_modules/**',
      'dist/**',
      'sdk/**',
      'tests/browser/**', // Exclude Playwright tests
    ],

    // Global test setup - commented out to avoid import issues
    // globalSetup: ['tests/vitest.global-setup.ts'],
    // setupFiles: ['tests/vitest.setup.ts'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'sdk/**',
        'tests/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/coverage/**',
      ],
      thresholds: {
        global: {
          branches: 90,
          functions: 90,
          lines: 90,
          statements: 90,
        },
      },
    },

    // Timeout configuration
    testTimeout: 10000,
    hookTimeout: 30000,

    // Pool configuration for better performance
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        minThreads: 1,
        maxThreads: 4,
      },
    },

    // Mock configuration
    clearMocks: true,
    restoreMocks: true,

    // Cloudflare Workers specific configuration
    alias: {
      '@': resolve(__dirname, './src'),
      '@/types': resolve(__dirname, './src/types'),
      '@/services': resolve(__dirname, './src/services'),
      '@/utils': resolve(__dirname, './src/utils'),
    },

    // Environment variables for tests
    env: {
      NODE_ENV: 'test',
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'debug',
      MAX_SHARD_SIZE_GB: '1',
      CACHE_TTL_MS: '1000',
      CACHE_SWR_MS: '2000',
      SHARD_COUNT: '4',
    },
  },

  // ESBuild configuration for TypeScript
  esbuild: {
    target: 'esnext',
    format: 'esm',
  },

  // Resolve configuration
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@/types': resolve(__dirname, './src/types'),
      '@/services': resolve(__dirname, './src/services'),
      '@/utils': resolve(__dirname, './src/utils'),
    },
  },
});
