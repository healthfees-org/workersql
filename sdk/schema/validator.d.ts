/**
 * Schema Validation Utilities
 * Common validation logic for all SDK implementations
 */
import { DatabaseConfig, QueryRequest, BatchQueryRequest, CacheOptions, ErrorCode } from './types.js';
export declare class ValidationError extends Error {
    readonly code: ErrorCode;
    readonly details: Record<string, any>;
    constructor(code: ErrorCode, message: string, details?: Record<string, any>);
}
export declare class SchemaValidator {
    static validateDatabaseConfig(config: Partial<DatabaseConfig>): DatabaseConfig;
    static validateQueryRequest(request: Partial<QueryRequest>): QueryRequest;
    static validateCacheOptions(cache: Partial<CacheOptions>): CacheOptions;
    static validateBatchQueryRequest(request: Partial<BatchQueryRequest>): BatchQueryRequest;
    static sanitizeSQL(sql: string): string;
}
//# sourceMappingURL=validator.d.ts.map