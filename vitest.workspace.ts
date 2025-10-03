import { defineWorkspace, defineProject } from 'vitest/config';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const workspace = defineWorkspace([
  // Node-based unit tests
  defineProject({
    test: {
      name: 'node',
      environment: 'node',
      globals: true,
      include: ['tests/**/*.{test,spec}.{js,ts}'],
      exclude: ['tests/integration/**', 'node_modules/**', 'dist/**', 'sdk/**', 'tests/e2e/**'],
      deps: { inline: ['vitest'], interopDefault: true },
      setupFiles: ['tests/vitest.setup.ts'],
      testTimeout: 10000,
      hookTimeout: 30000,
      pool: 'threads',
      poolOptions: { threads: { singleThread: true } },
      clearMocks: true,
      restoreMocks: true,
      alias: {
        '@': resolve(__dirname, './src'),
        '@/types': resolve(__dirname, './src/types'),
        '@/services': resolve(__dirname, './src/services'),
        '@/utils': resolve(__dirname, './src/utils'),
      },
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
  }),

  // Workers runtime integration tests
  defineWorkersProject({
    test: {
      name: 'workers',
      include: ['tests/integration/**/*.test.ts'],
      setupFiles: ['tests/vitest.setup.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.toml', environment: 'development' },
        },
      },
      sequence: { concurrent: false },
      clearMocks: true,
      restoreMocks: true,
      alias: {
        '@': resolve(__dirname, './src'),
        '@/types': resolve(__dirname, './src/types'),
        '@/services': resolve(__dirname, './src/services'),
        '@/utils': resolve(__dirname, './src/utils'),
      },
    },
  }),
]);

export default workspace;
