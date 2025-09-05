import { Miniflare } from 'miniflare';
import type { CloudflareEnvironment } from '../src/types';
/**
 * Global test setup for Miniflare v4-based testing
 * Provides isolated Cloudflare Workers environment for each test
 */
declare global {
    var mf: Miniflare;
    var env: CloudflareEnvironment;
}
/**
 * Helper function to create a test request
 */
export declare function createTestRequest(url: string, init?: RequestInit): Request;
/**
 * Helper function to create test SQL request body
 */
export declare function createSQLRequest(sql: string, params?: unknown[], hints?: any): string;
/**
 * Helper function to assert response structure
 */
export declare function assertValidResponse(response: Response): void;
/**
 * Helper function to create mock environment for unit tests
 */
export declare function createMockEnvironment(): CloudflareEnvironment;
/**
 * Test data factory for consistent test data
 */
export declare class TestDataFactory {
    static createUser(overrides?: Partial<any>): any;
    static createOrder(overrides?: Partial<any>): any;
    static createProduct(overrides?: Partial<any>): any;
}
/**
 * Performance testing utilities
 */
export declare class PerformanceTestUtils {
    static measureExecutionTime<T>(operation: () => Promise<T>): Promise<{
        result: T;
        executionTime: number;
    }>;
    static assertPerformance(executionTime: number, maxMs: number, operationName: string): void;
}
export * from 'vitest';
//# sourceMappingURL=setup.d.ts.map
