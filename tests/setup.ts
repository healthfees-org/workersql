import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import type { CloudflareEnvironment } from '../src/types';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Global test setup for Miniflare v4-based testing
 * Provides isolated Cloudflare Workers environment for each test
 */

declare global {
  var mf: Miniflare;
  var env: CloudflareEnvironment;
}

// Test timeout configuration
vi.setConfig({ testTimeout: 30000 });

// Miniflare instance for isolated testing
let miniflare: Miniflare;

beforeAll(async () => {
  // Build the worker first to ensure dist/gateway.js exists
  const { execSync } = require('child_process');
  try {
    execSync('npm run build', { stdio: 'pipe' });
  } catch (error) {
    console.warn('Build failed, using existing dist if available');
  }

  // Ensure gateway build exists; we'll point Miniflare at the built file via scriptPath

  // Initialize Miniflare v4 with complete Cloudflare Workers environment
  miniflare = new Miniflare({
    modules: true,
    // Load worker directly from built file so relative imports resolve
    scriptPath: join(__dirname, '../dist/gateway.js'),

    // KV Namespaces for caching
    kvNamespaces: {
      APP_CACHE: 'test-cache',
    },

    // Durable Objects not required for current unit tests; omit to avoid
    // requiring class exports from the entry module.

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
      CACHE_TTL_MS: '5000',
      CACHE_SWR_MS: '10000',
    },

    // Enable compatibility features
    compatibilityDate: '2024-08-31',
    compatibilityFlags: ['nodejs_compat'],
  });

  // Make Miniflare globally available
  global.mf = miniflare;

  // Get environment bindings for tests
  global.env = await miniflare.getBindings();
});

afterAll(async () => {
  if (miniflare) {
    await miniflare.dispose();
  }
});

beforeEach(async () => {
  // Clear KV cache before each test
  if (global.env?.APP_CACHE) {
    await global.env.APP_CACHE.delete('');
  }

  // Reset any test state
  console.log('Starting test with clean state');
});

afterEach(async () => {
  // Cleanup after each test
  if (global.env?.APP_CACHE) {
    // Clear all cache entries with wildcard pattern
    const keys = await global.env.APP_CACHE.list();
    for (const key of keys.keys) {
      await global.env.APP_CACHE.delete(key.name);
    }
  }

  console.log('Test cleanup completed');
});

/**
 * Helper function to create a test request
 */
export function createTestRequest(url: string, init?: RequestInit): Request {
  return new Request(url, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token-12345',
      ...init?.headers,
    },
    ...init,
  });
}

/**
 * Helper function to create test SQL request body
 */
export function createSQLRequest(sql: string, params?: unknown[], hints?: any): string {
  return JSON.stringify({
    sql,
    params: params || [],
    hints,
  });
}

/**
 * Helper function to assert response structure
 */
export function assertValidResponse(response: Response): void {
  expect(response).toBeDefined();
  expect(response.status).toBeGreaterThanOrEqual(200);
  expect(response.status).toBeLessThan(600);
}

/**
 * Helper function to create mock environment for unit tests
 */
export function createMockEnvironment(): CloudflareEnvironment {
  const mockKV = {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn().mockResolvedValue({ keys: [] }),
  } as any;

  const mockQueue = {
    send: vi.fn(),
    sendBatch: vi.fn(),
  } as any;

  const mockDO = {
    get: vi.fn(),
    idFromName: vi.fn(),
  } as any;

  const mockD1 = {
    prepare: vi.fn(),
    exec: vi.fn(),
    batch: vi.fn(),
  } as any;

  return {
    APP_CACHE: mockKV,
    DB_EVENTS: mockQueue,
    SHARD: mockDO,
    PORTABLE_DB: mockD1,
    ENVIRONMENT: 'test',
    LOG_LEVEL: 'debug',
    MAX_SHARD_SIZE_GB: '1',
    CACHE_TTL_MS: '5000',
    CACHE_SWR_MS: '10000',
  };
}

/**
 * Test data factory for consistent test data
 */
export class TestDataFactory {
  static createUser(overrides: Partial<any> = {}): any {
    return {
      id: 1,
      name: 'Test User',
      email: 'test@example.com',
      created_at: new Date().toISOString(),
      ...overrides,
    };
  }

  static createOrder(overrides: Partial<any> = {}): any {
    return {
      id: 1,
      user_id: 1,
      total: 99.99,
      status: 'pending',
      created_at: new Date().toISOString(),
      ...overrides,
    };
  }

  static createProduct(overrides: Partial<any> = {}): any {
    return {
      id: 1,
      name: 'Test Product',
      price: 29.99,
      stock: 100,
      created_at: new Date().toISOString(),
      ...overrides,
    };
  }
}

/**
 * Performance testing utilities
 */
export class PerformanceTestUtils {
  static async measureExecutionTime<T>(
    operation: () => Promise<T>
  ): Promise<{ result: T; executionTime: number }> {
    const start = performance.now();
    const result = await operation();
    const executionTime = performance.now() - start;
    return { result, executionTime };
  }

  static assertPerformance(executionTime: number, maxMs: number, operationName: string): void {
    expect(executionTime).toBeLessThanOrEqual(maxMs);
    console.log(`${operationName} completed in ${executionTime.toFixed(2)}ms`);
  }
}

// Export test utilities for use in test files
export * from 'vitest';
