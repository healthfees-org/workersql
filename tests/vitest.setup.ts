import { vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { CloudflareEnvironment } from '../src/types';

// Polyfill crypto for Node.js environment
const origCrypto = globalThis.crypto as any;
const poly: any = origCrypto ?? webcrypto;
if (!poly.getRandomValues) {
  poly.getRandomValues = (array: Uint8Array) => {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
    return array;
  };
}
if (!poly.randomUUID) {
  poly.randomUUID = () => {
    // RFC4122 v4
    const bytes = new Uint8Array(16);
    poly.getRandomValues(bytes);
    // Indexing into fixed-length array is safe
    bytes[6] = ((bytes as any)[6] & 0x0f) | 0x40;
    bytes[8] = ((bytes as any)[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}
// Only define global crypto if it's missing; avoid overriding read-only getter
if (!origCrypto) {
  Object.defineProperty(globalThis, 'crypto', {
    value: poly,
    configurable: true,
  });
}

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
