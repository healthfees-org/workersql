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
        miniflare: {
          compatibilityDate: '2023-01-01',
        },
      },
    },
    sequence: { concurrent: false },
    clearMocks: true,
    restoreMocks: true,
  },
});
