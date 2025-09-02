/**
 * WorkerSQL Common Types
 * Generated from workersql.schema.json
 * DO NOT MODIFY - This file is auto-generated
 */

export interface DatabaseConfig {
  host: string;
  port?: number;
  username: string;
  password: string;
  database: string;
  ssl?: boolean;
  timeout?: number;
}

export interface CacheOptions {
  enabled?: boolean;
  ttl?: number;
  key?: string;
}

export interface QueryRequest {
  sql: string;
  params?: (string | number | boolean | null)[];
  timeout?: number;
  cache?: CacheOptions;
}

export type ErrorCode =
  | 'INVALID_QUERY'
  | 'CONNECTION_ERROR'
  | 'TIMEOUT_ERROR'
  | 'AUTH_ERROR'
  | 'PERMISSION_ERROR'
  | 'RESOURCE_LIMIT'
  | 'INTERNAL_ERROR';

export interface ErrorResponse {
  code: ErrorCode;
  message: string;
  details?: Record<string, any>;
  timestamp: string;
}

export interface QueryResponse {
  success: boolean;
  data?: Record<string, any>[];
  rowCount?: number;
  executionTime?: number;
  cached?: boolean;
  error?: ErrorResponse;
}

export interface BatchQueryRequest {
  queries: QueryRequest[];
  transaction?: boolean;
  stopOnError?: boolean;
}

export interface BatchQueryResponse {
  success: boolean;
  results: QueryResponse[];
  totalExecutionTime?: number;
}

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheckResponse {
  status: HealthStatus;
  database: {
    connected: boolean;
    responseTime?: number;
  };
  cache: {
    enabled: boolean;
    hitRate?: number;
  };
  timestamp: string;
}

// SDK Configuration
export interface SDKConfig extends DatabaseConfig {
  apiEndpoint?: string;
  apiKey?: string;
  retryAttempts?: number;
  retryDelay?: number;
}
