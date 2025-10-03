import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersProject({
  test: {
    name: 'workers',
    include: [
      'tests/integration/**/*.worker.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/integration/**/worker.*.test.ts',
    ],
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
});
