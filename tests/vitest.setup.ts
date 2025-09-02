import { vi } from 'vitest';
import type { CloudflareEnvironment } from '../src/types';

// Mock environment factory for unit tests
export function createMockEnvironment(): CloudflareEnvironment {
  const mockKV = {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [] }),
    getWithMetadata: vi.fn().mockResolvedValue(null),
  } as unknown as KVNamespace;

  const mockQueue = {
    send: vi.fn(),
    sendBatch: vi.fn(),
  } as any;

  const mockDO = {
    get: vi.fn(),
    idFromName: vi.fn(),
    idFromString: vi.fn(),
    newUniqueId: vi.fn(),
    getByName: vi.fn(),
    jurisdiction: vi.fn(),
  } as any;

  const mockD1 = {
    prepare: vi.fn(),
    exec: vi.fn(),
    batch: vi.fn(),
    dump: vi.fn(),
    withSession: vi.fn(),
  } as any;

  return {
    APP_CACHE: mockKV,
    DB_EVENTS: mockQueue,
    SHARD: mockDO,
    PORTABLE_DB: mockD1,
    ENVIRONMENT: 'test',
    LOG_LEVEL: 'debug',
    MAX_SHARD_SIZE_GB: '1',
    CACHE_TTL_MS: '1000',
    CACHE_SWR_MS: '2000',
    SHARD_COUNT: '4',
  };
}

// Test data factory for consistent test data
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

// Performance testing utilities
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
