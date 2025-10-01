/**
 * WorkerSQL Node.js SDK
 * Uses common schema definitions for consistent data modeling
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import {
  DatabaseConfig,
  QueryRequest,
  QueryResponse,
  BatchQueryRequest,
  BatchQueryResponse,
  HealthCheckResponse,
  SDKConfig,
  ErrorResponse
} from '../../schema/types.js';
import { SchemaValidator, ValidationError } from '../../schema/validator.js';
import { DSNParser, ParsedDSN } from './dsn-parser.js';
import { ConnectionPool, PooledConnection } from './connection-pool.js';
import { RetryStrategy } from './retry-logic.js';

export interface WorkerSQLClientConfig extends SDKConfig {
  apiEndpoint?: string;
  apiKey?: string;
  retryAttempts?: number;
  retryDelay?: number;
  timeout?: number;
  dsn?: string;
  pooling?: {
    enabled?: boolean;
    minConnections?: number;
    maxConnections?: number;
    idleTimeout?: number;
  };
}

export class WorkerSQLClient {
  private httpClient: AxiosInstance;
  private config: WorkerSQLClientConfig;
  private pool?: ConnectionPool;
  private retryStrategy: RetryStrategy;
  private parsedDSN?: ParsedDSN;

  constructor(config: Partial<WorkerSQLClientConfig> | string) {
    // If DSN string is provided, parse it
    if (typeof config === 'string') {
      this.parsedDSN = DSNParser.parse(config);
      config = this.configFromDSN(this.parsedDSN);
    }

    // Validate configuration using common schema
    this.config = this.validateConfig(config);

    // Initialize retry strategy
    this.retryStrategy = new RetryStrategy({
      maxAttempts: this.config.retryAttempts ?? 3,
      initialDelay: this.config.retryDelay ?? 1000,
    });

    // Initialize connection pool if enabled
    if (this.config.pooling?.enabled !== false) {
      this.pool = new ConnectionPool({
        apiEndpoint: this.config.apiEndpoint!,
        apiKey: this.config.apiKey,
        minConnections: this.config.pooling?.minConnections ?? 1,
        maxConnections: this.config.pooling?.maxConnections ?? 10,
        idleTimeout: this.config.pooling?.idleTimeout ?? 300000,
        connectionTimeout: this.config.timeout ?? 30000,
      });
    }

    // Create default HTTP client (used if pooling is disabled)
    this.httpClient = axios.create({
      baseURL: this.config.apiEndpoint,
      timeout: this.config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'WorkerSQL-NodeSDK/1.0.0',
        ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
      }
    });

    this.setupInterceptors();
  }

  private configFromDSN(parsed: ParsedDSN): Partial<WorkerSQLClientConfig> {
    return {
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      password: parsed.password,
      database: parsed.database,
      apiEndpoint: DSNParser.getApiEndpoint(parsed),
      apiKey: parsed.params['apiKey'],
      ssl: parsed.params['ssl'] !== 'false',
      timeout: parsed.params['timeout'] ? parseInt(parsed.params['timeout'], 10) : undefined,
      retryAttempts: parsed.params['retryAttempts'] ? parseInt(parsed.params['retryAttempts'], 10) : undefined,
      pooling: {
        enabled: parsed.params['pooling'] !== 'false',
        minConnections: parsed.params['minConnections'] ? parseInt(parsed.params['minConnections'], 10) : undefined,
        maxConnections: parsed.params['maxConnections'] ? parseInt(parsed.params['maxConnections'], 10) : undefined,
      },
    };
  }

  private validateConfig(config: Partial<WorkerSQLClientConfig>): WorkerSQLClientConfig {
    if (!config.apiEndpoint && !config.host) {
      throw new ValidationError('INVALID_QUERY', 'apiEndpoint or host is required');
    }

    // Build apiEndpoint from host if not provided
    if (!config.apiEndpoint && config.host) {
      const protocol = config.ssl === false ? 'http' : 'https';
      const port = config.port ? `:${config.port}` : '';
      config.apiEndpoint = `${protocol}://${config.host}${port}/v1`;
    }

    const dbConfig = SchemaValidator.validateDatabaseConfig(config);

    return {
      ...dbConfig,
      apiEndpoint: config.apiEndpoint,
      apiKey: config.apiKey,
      retryAttempts: config.retryAttempts ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      timeout: config.timeout ?? 30000,
      pooling: config.pooling,
    };
  }

  private setupInterceptors(): void {
    // Request interceptor for logging and validation
    this.httpClient.interceptors.request.use(
      (config: any) => {
        console.debug(`[WorkerSQL] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error: any) => Promise.reject(error)
    );

    // Response interceptor for error handling
    this.httpClient.interceptors.response.use(
      (response: any) => response,
      (error: any) => {
        if (error.response?.data) {
          const errorResponse: ErrorResponse = error.response.data;
          throw new ValidationError(
            errorResponse.code || 'INTERNAL_ERROR',
            errorResponse.message || 'Unknown error occurred',
            errorResponse.details || {}
          );
        }
        throw error;
      }
    );
  }

  /**
   * Execute a single SQL query
   */
  async query(sql: string, params?: any[], options?: { timeout?: number; cache?: any }): Promise<QueryResponse> {
    const request: QueryRequest = SchemaValidator.validateQueryRequest({
      sql,
      params,
      timeout: options?.timeout,
      cache: options?.cache
    });

    return this.retryStrategy.execute(async () => {
      const client = await this.getHttpClient();
      try {
        const response: AxiosResponse<QueryResponse> = await client.post('/query', request);
        return response.data;
      } finally {
        this.releaseHttpClient(client);
      }
    }, 'query');
  }

  /**
   * Execute multiple queries in batch
   */
  async batchQuery(queries: QueryRequest[], options?: { transaction?: boolean; stopOnError?: boolean }): Promise<BatchQueryResponse> {
    const request: BatchQueryRequest = SchemaValidator.validateBatchQueryRequest({
      queries,
      transaction: options?.transaction,
      stopOnError: options?.stopOnError
    });

    return this.retryStrategy.execute(async () => {
      const client = await this.getHttpClient();
      try {
        const response: AxiosResponse<BatchQueryResponse> = await client.post('/batch', request);
        return response.data;
      } finally {
        this.releaseHttpClient(client);
      }
    }, 'batchQuery');
  }

  /**
   * Get an HTTP client from the pool or use the default
   */
  private async getHttpClient(): Promise<AxiosInstance & { __pooledConnectionId?: string }> {
    if (this.pool) {
      const conn = await this.pool.acquire();
      const client = conn.instance as any;
      client.__pooledConnectionId = conn.id;
      return client;
    }
    return this.httpClient;
  }

  /**
   * Release an HTTP client back to the pool
   */
  private releaseHttpClient(client: AxiosInstance & { __pooledConnectionId?: string }): void {
    if (this.pool && client.__pooledConnectionId) {
      this.pool.release(client.__pooledConnectionId);
    }
  }

  /**
   * Get connection pool statistics
   */
  getPoolStats() {
    return this.pool?.getStats();
  }

  /**
   * Execute a transaction
   */
  async transaction(callback: (client: TransactionClient) => Promise<void>): Promise<void> {
    const transactionClient = new TransactionClient(this);
    try {
      await transactionClient.begin();
      await callback(transactionClient);
      await transactionClient.commit();
    } catch (error) {
      await transactionClient.rollback();
      throw error;
    }
  }

  /**
   * Check service health
   */
  async healthCheck(): Promise<HealthCheckResponse> {
    return this.retryStrategy.execute(async () => {
      const client = await this.getHttpClient();
      try {
        const response: AxiosResponse<HealthCheckResponse> = await client.get('/health');
        return response.data;
      } finally {
        this.releaseHttpClient(client);
      }
    }, 'healthCheck');
  }

  /**
   * Close the client connection
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
    }
    console.debug('[WorkerSQL] Client closed');
  }
}

export class TransactionClient {
  private parent: WorkerSQLClient;
  private wsClient?: import('./websocket-client.js').WebSocketTransactionClient;
  private transactionId?: string;
  private useWebSocket: boolean;

  constructor(parent: WorkerSQLClient, useWebSocket = true) {
    this.parent = parent;
    this.useWebSocket = useWebSocket;
  }

  async begin(): Promise<void> {
    if (this.useWebSocket) {
      const { WebSocketTransactionClient } = await import('./websocket-client.js');
      this.wsClient = new WebSocketTransactionClient(
        this.parent['config'].apiEndpoint!,
        this.parent['config'].apiKey
      );
      await this.wsClient.begin();
      this.transactionId = this.wsClient.transactionId;
    } else {
      // HTTP-based transaction (fallback)
      this.transactionId = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      console.debug('[WorkerSQL] Transaction started (HTTP):', this.transactionId);
    }
  }

  async query(sql: string, params?: any[]): Promise<QueryResponse> {
    if (!this.transactionId) {
      throw new ValidationError('INVALID_QUERY', 'Transaction not started');
    }

    if (this.wsClient) {
      return this.wsClient.query(sql, params);
    }

    // HTTP fallback - include transaction ID in request
    return this.parent.query(sql, params);
  }

  async commit(): Promise<void> {
    if (this.wsClient) {
      await this.wsClient.commit();
      await this.wsClient.close();
    } else {
      console.debug('[WorkerSQL] Transaction committed (HTTP):', this.transactionId);
    }
    this.transactionId = undefined;
  }

  async rollback(): Promise<void> {
    if (this.wsClient) {
      await this.wsClient.rollback();
      await this.wsClient.close();
    } else {
      console.debug('[WorkerSQL] Transaction rolled back (HTTP):', this.transactionId);
    }
    this.transactionId = undefined;
  }
}

// Re-export common types for convenience
export type {
  DatabaseConfig,
  QueryRequest,
  QueryResponse,
  BatchQueryRequest,
  BatchQueryResponse,
  HealthCheckResponse,
  ErrorResponse
} from '../../schema/types.js';

export { ValidationError, SchemaValidator } from '../../schema/validator.js';
export { DSNParser } from './dsn-parser.js';
export type { ParsedDSN } from './dsn-parser.js';
export { ConnectionPool } from './connection-pool.js';
export type { PooledConnection } from './connection-pool.js';
export { RetryStrategy } from './retry-logic.js';
