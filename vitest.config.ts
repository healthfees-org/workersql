import { defineConfig } from 'vitest/config';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';
import { resolve } from 'path';

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
    projects: [
      {
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
        resolve: {
          alias: {
            '@': resolve(__dirname, './src'),
            '@/types': resolve(__dirname, './src/types'),
            '@/services': resolve(__dirname, './src/services'),
            '@/utils': resolve(__dirname, './src/utils'),
          },
        },
      },
      // Workers runtime integration tests
      Object.assign(
        defineWorkersProject({
          test: {
            name: 'workers',
            include: ['tests/integration/**/*.worker.test.ts', 'tests/integration/**/*.test.ts'],
            setupFiles: ['tests/vitest.setup.ts'],
            poolOptions: {
              workers: {
                wrangler: { configPath: './wrangler.toml', environment: 'development' },
              },
            },
            sequence: { concurrent: false },
            clearMocks: true,
            restoreMocks: true,
          },
        }),
        {
          resolve: {
            alias: {
              '@': resolve(__dirname, './src'),
              '@/types': resolve(__dirname, './src/types'),
              '@/services': resolve(__dirname, './src/services'),
              '@/utils': resolve(__dirname, './src/utils'),
            },
          },
        }
      ) as any,
    ],
  },
});
