/// <reference types="@cloudflare/workers-types" />

// Core environment bindings for Cloudflare Workers
export interface Env extends CloudflareEnvironment {
  // KV Namespace for caching
  APP_CACHE: KVNamespace;

  // Queue for database events
  DB_EVENTS: Queue;

  // Durable Object binding for shards
  SHARD: DurableObjectNamespace;

  // D1 database for portable mirror
  PORTABLE_DB: D1Database;

  // Environment variables
  ENVIRONMENT: string;
  LOG_LEVEL: string;
  MAX_SHARD_SIZE_GB: string;
  CACHE_TTL_MS: string;
  CACHE_SWR_MS: string;
  DEFAULT_CACHE_TTL?: string;
  DEFAULT_CACHE_SWR?: string;
  SHARD_COUNT?: string;
  JWT_SECRET?: string;
}

// SQL query types
export interface QueryRequest {
  sql: string;
  params?: unknown[];
  hints?: QueryHints;
  transactionId?: string;
}

export interface QueryHints {
  consistency?: 'strong' | 'bounded' | 'cached';
  boundedMs?: number;
  shardKey?: string;
  tenantId?: string;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowsAffected?: number;
  insertId?: number;
  metadata?: {
    fromCache?: boolean;
    shardId?: string;
    executionTimeMs?: number;
  };
}

// Routing and sharding types
export interface RoutingPolicy {
  version: number;
  tenants: Record<string, string>; // tenant_id -> shard_id
  ranges: Array<{
    prefix: string;
    shard: string;
  }>;
}

export interface TablePolicy {
  pk: string;
  shardBy?: string;
  cache: CachePolicy;
}

export interface CachePolicy {
  mode: 'strong' | 'bounded' | 'cached';
  ttlMs: number;
  swrMs: number;
  alwaysStrongColumns?: string[];
}

// Cache key patterns
export type CacheKeyType = 'entity' | 'index' | 'query';

export interface CacheEntry<T = unknown> {
  data: T;
  version: number;
  freshUntil: number;
  swrUntil: number;
  shardId: string;
}

// Event system types
export interface DatabaseEvent {
  type: 'invalidate' | 'prewarm' | 'd1_sync';
  shardId: string;
  version: number;
  timestamp: number;
  keys?: string[];
  data?: unknown;
}

// Authentication and security
export interface AuthContext {
  tenantId: string;
  userId?: string;
  permissions: string[];
  tokenHash: string;
}

// Connection and session management
export interface ConnectionState {
  id: string;
  shardId?: string;
  transactionId?: string;
  tenantId: string;
  lastActivity: number;
  isInTransaction: boolean;
}

// Error types
export class EdgeSQLError extends Error {
  constructor(
    message: string,
    public code: string,
    public sqlState?: string,
    public errno?: number
  ) {
    super(message);
    this.name = 'EdgeSQLError';
  }
}

export class ShardCapacityError extends EdgeSQLError {
  constructor(shardId: string, currentSize: number, maxSize: number) {
    super(
      `Shard ${shardId} at capacity: ${currentSize}GB of ${maxSize}GB`,
      'SHARD_CAPACITY_EXCEEDED'
    );
  }
}

export class CacheError extends EdgeSQLError {
  constructor(message: string, operation: string) {
    super(`Cache ${operation} failed: ${message}`, 'CACHE_ERROR');
  }
}

// Gateway-specific types
export interface CloudflareEnvironment {
  APP_CACHE: KVNamespace;
  DB_EVENTS: Queue;
  SHARD: DurableObjectNamespace;
  PORTABLE_DB: D1Database;
  ENVIRONMENT: string;
  LOG_LEVEL: string;
  MAX_SHARD_SIZE_GB: string;
  CACHE_TTL_MS: string;
  CACHE_SWR_MS: string;
  DEFAULT_CACHE_TTL?: string;
  DEFAULT_CACHE_SWR?: string;
  SHARD_COUNT?: string;
  JWT_SECRET?: string;
}

export interface WorkerRequest {
  sql: string;
  params?: unknown[];
  hints?: QueryHints;
  transactionId?: string;
}

export interface WorkerResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  cached?: boolean;
  executionTime?: number;
  metadata?: {
    shardId?: string;
    fromCache?: boolean;
    version?: number;
  };
}

export interface SQLQuery {
  sql: string;
  params: unknown[];
  type: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'DDL';
  tableName: string;
  timestamp: number;
  hints?: QueryHints;
}

export interface ShardBinding {
  id: string;
  namespace: DurableObjectNamespace;
}

// Configuration types
export interface EdgeSQLConfig {
  routing: RoutingPolicy;
  tables: Record<string, TablePolicy>;
  security: {
    tokenValidation: boolean;
    auditLogging: boolean;
    encryptionAtRest: boolean;
  };
  performance: {
    maxConnections: number;
    queryTimeoutMs: number;
    cacheEnabled: boolean;
  };
}
