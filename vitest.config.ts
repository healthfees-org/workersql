import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    // Test environment configuration
    environment: 'node',

    // Include patterns for test files
    include: ['tests/**/*.{test,spec}.{js,ts}'],

    deps: {
      inline: ['vitest'],
      interopDefault: true,
    },

    // Exclude patterns
    exclude: [
      'node_modules/**',
      'dist/**',
      'sdk/**',
      'tests/e2e/**', // Exclude Playwright tests
    ],

    // Global test setup - commented out to avoid import issues
    // globalSetup: ['tests/vitest.global-setup.ts'],
    // setupFiles: ['tests/vitest.setup.ts'],

    // Coverage configuration
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'html', 'json', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/types/**',
        'src/**/*.d.ts',
        'tests/**',
        'node_modules/**',
        'dist/**',
        'coverage/**',
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
      // Persist coverage output between runs to compare deltas
      clean: false,
      reportsDirectory: './coverage',
      // Watermarks for report UI
      watermarks: {
        lines: [80, 95],
        functions: [80, 95],
        branches: [80, 95],
        statements: [80, 95],
      },
      // Include all source files so untouched files are shown explicitly
      all: true,
      // v8 respects source maps automatically; keep directory stable
      reportOnFailure: true,
    },

    // Timeout configuration
    testTimeout: 10000,
    hookTimeout: 30000,

    // Pool configuration for better performance
    pool: 'threads',
    poolOptions: {
      threads: {
        // Use single thread when collecting coverage to avoid flaky merge issues
        singleThread: true,
        minThreads: 1,
        maxThreads: 1,
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
