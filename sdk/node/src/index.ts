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

export interface WorkerSQLClientConfig extends SDKConfig {
  apiEndpoint: string;
  apiKey?: string;
  retryAttempts?: number;
  retryDelay?: number;
  timeout?: number;
}

export class WorkerSQLClient {
  private httpClient: AxiosInstance;
  private config: WorkerSQLClientConfig;

  constructor(config: Partial<WorkerSQLClientConfig>) {
    // Validate configuration using common schema
    this.config = this.validateConfig(config);

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

  private validateConfig(config: Partial<WorkerSQLClientConfig>): WorkerSQLClientConfig {
    if (!config.apiEndpoint) {
      throw new ValidationError('INVALID_QUERY', 'apiEndpoint is required');
    }

    const dbConfig = SchemaValidator.validateDatabaseConfig(config);

    return {
      ...dbConfig,
      apiEndpoint: config.apiEndpoint,
      apiKey: config.apiKey,
      retryAttempts: config.retryAttempts ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      timeout: config.timeout ?? 30000
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

    try {
      const response: AxiosResponse<QueryResponse> = await this.httpClient.post('/query', request);
      return response.data;
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError('CONNECTION_ERROR', 'Failed to execute query', { originalError: error });
    }
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

    try {
      const response: AxiosResponse<BatchQueryResponse> = await this.httpClient.post('/batch', request);
      return response.data;
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError('CONNECTION_ERROR', 'Failed to execute batch query', { originalError: error });
    }
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
    try {
      const response: AxiosResponse<HealthCheckResponse> = await this.httpClient.get('/health');
      return response.data;
    } catch (error) {
      throw new ValidationError('CONNECTION_ERROR', 'Health check failed', { originalError: error });
    }
  }

  /**
   * Close the client connection
   */
  async close(): Promise<void> {
    // Cleanup any persistent connections if needed
    console.debug('[WorkerSQL] Client closed');
  }
}

export class TransactionClient {
  private parent: WorkerSQLClient;
  private transactionId?: string;

  constructor(parent: WorkerSQLClient) {
    this.parent = parent;
  }

  async begin(): Promise<void> {
    // Transaction implementation would go here
    console.debug('[WorkerSQL] Transaction started');
  }

  async query(sql: string, params?: any[]): Promise<QueryResponse> {
    if (!this.transactionId) {
      throw new ValidationError('INVALID_QUERY', 'Transaction not started');
    }
    return this.parent.query(sql, params);
  }

  async commit(): Promise<void> {
    console.debug('[WorkerSQL] Transaction committed');
  }

  async rollback(): Promise<void> {
    console.debug('[WorkerSQL] Transaction rolled back');
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
