import { Miniflare } from 'miniflare';

let miniflare: Miniflare;

// Global setup function for Vitest - runs before all tests
export async function setup() {
  // Global setup for Vitest tests using Miniflare
  miniflare = new Miniflare({
    modules: true,
    scriptPath: new URL('../dist/src/gateway.js', import.meta.url).pathname,

    // KV Namespaces for caching
    kvNamespaces: {
      APP_CACHE: 'test-cache',
    },

    // Queues for event processing
    queueProducers: {
      DB_EVENTS: {
        queueName: 'test-events-queue',
      },
    },

    // D1 Database
    d1Databases: {
      PORTABLE_DB: 'test-portable-db',
    },

    // Environment variables
    bindings: {
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'debug',
      MAX_SHARD_SIZE_GB: '1',
      CACHE_TTL_MS: '1000',
      CACHE_SWR_MS: '2000',
      SHARD_COUNT: '4',
    },

    // Enable compatibility features
    compatibilityDate: '2024-08-31',
    compatibilityFlags: ['nodejs_compat'],
  });

  // Make available globally for tests
  globalThis.__MINIFLARE__ = miniflare;
}

// Global teardown function for Vitest - runs after all tests
export async function teardown() {
  if (miniflare) {
    await miniflare.dispose();
  }
}
