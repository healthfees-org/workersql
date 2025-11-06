import { BaseService } from './BaseService';
import { CloudflareEnvironment, EdgeSQLError } from '../types';

/**
 * D1 REST API Response Types
 */
export interface D1Database {
  uuid: string;
  name: string;
  version: string;
  num_tables: number;
  file_size: number;
  created_at: string;
}

export interface D1ListResponse {
  result: D1Database[];
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<string>;
  result_info: {
    page: number;
    per_page: number;
    count: number;
    total_count: number;
  };
}

export interface D1CreateResponse {
  result: D1Database;
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<string>;
}

export interface D1QueryResult {
  results: Array<Record<string, unknown>>;
  success: boolean;
  meta: {
    changed_db: boolean;
    changes: number;
    duration: number;
    last_row_id: number;
    rows_read: number;
    rows_written: number;
    size_after: number;
  };
}

export interface D1BatchResult {
  result: D1QueryResult[];
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<string>;
}

/**
 * D1Service - Service for managing D1 databases via Cloudflare REST API
 * 
 * Implements CRUD operations for D1 databases using the official Cloudflare API:
 * https://developers.cloudflare.com/api/resources/d1/
 * 
 * This service handles:
 * - Database creation and deletion
 * - Database listing and information retrieval
 * - SQL query execution via REST API
 * - Batch query operations
 * - Proper authentication and error handling
 */
export class D1Service extends BaseService {
  private accountId: string;
  private apiToken: string;
  private baseUrl: string;

  constructor(env: CloudflareEnvironment) {
    super(env);
    
    // Extract configuration from environment
    const envVars = env as unknown as Record<string, string>;
    this.accountId = envVars['CLOUDFLARE_ACCOUNT_ID'] || '';
    this.apiToken = envVars['CLOUDFLARE_API_TOKEN'] || '';
    this.baseUrl = 'https://api.cloudflare.com/client/v4';

    if (!this.accountId || !this.apiToken) {
      this.log('warn', 'D1Service: Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN');
    }
  }

  /**
   * List all D1 databases in the account
   * GET /accounts/{account_id}/d1/database
   */
  async listDatabases(): Promise<D1Database[]> {
    this.validateConfig();

    const url = `${this.baseUrl}/accounts/${this.accountId}/d1/database`;
    
    return await this.retryWithBackoff(async () => {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      const data = await response.json() as D1ListResponse;

      if (!data.success) {
        throw new EdgeSQLError(
          `Failed to list D1 databases: ${data.errors.map(e => e.message).join(', ')}`,
          'D1_API_ERROR'
        );
      }

      this.log('info', 'Listed D1 databases', { count: data.result.length });
      return data.result;
    });
  }

  /**
   * Create a new D1 database
   * POST /accounts/{account_id}/d1/database
   */
  async createDatabase(name: string, location?: string): Promise<D1Database> {
    this.validateConfig();

    const url = `${this.baseUrl}/accounts/${this.accountId}/d1/database`;
    const body: { name: string; location?: string } = { name };
    if (location) {
      body.location = location;
    }

    return await this.retryWithBackoff(async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      });

      const data = await response.json() as D1CreateResponse;

      if (!data.success) {
        throw new EdgeSQLError(
          `Failed to create D1 database: ${data.errors.map(e => e.message).join(', ')}`,
          'D1_API_ERROR'
        );
      }

      this.log('info', 'Created D1 database', { name, uuid: data.result.uuid });
      return data.result;
    });
  }

  /**
   * Get information about a specific D1 database
   * GET /accounts/{account_id}/d1/database/{database_id}
   */
  async getDatabaseInfo(databaseId: string): Promise<D1Database> {
    this.validateConfig();

    const url = `${this.baseUrl}/accounts/${this.accountId}/d1/database/${databaseId}`;

    return await this.retryWithBackoff(async () => {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      const data = await response.json() as D1CreateResponse;

      if (!data.success) {
        throw new EdgeSQLError(
          `Failed to get D1 database info: ${data.errors.map(e => e.message).join(', ')}`,
          'D1_API_ERROR'
        );
      }

      this.log('debug', 'Retrieved D1 database info', { databaseId });
      return data.result;
    });
  }

  /**
   * Delete a D1 database
   * DELETE /accounts/{account_id}/d1/database/{database_id}
   */
  async deleteDatabase(databaseId: string): Promise<void> {
    this.validateConfig();

    const url = `${this.baseUrl}/accounts/${this.accountId}/d1/database/${databaseId}`;

    return await this.retryWithBackoff(async () => {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: this.getHeaders(),
      });

      const data = await response.json() as { success: boolean; errors: Array<{ code: number; message: string }> };

      if (!data.success) {
        throw new EdgeSQLError(
          `Failed to delete D1 database: ${data.errors.map(e => e.message).join(', ')}`,
          'D1_API_ERROR'
        );
      }

      this.log('info', 'Deleted D1 database', { databaseId });
    });
  }

  /**
   * Execute a SQL query on a D1 database
   * POST /accounts/{account_id}/d1/database/{database_id}/query
   */
  async query(
    databaseId: string,
    sql: string,
    params?: unknown[]
  ): Promise<D1QueryResult> {
    this.validateConfig();

    const url = `${this.baseUrl}/accounts/${this.accountId}/d1/database/${databaseId}/query`;
    const body = {
      sql,
      ...(params && params.length > 0 && { params }),
    };

    return await this.retryWithBackoff(async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      });

      const data = await response.json() as { result: D1QueryResult[]; success: boolean; errors: Array<{ code: number; message: string }> };

      if (!data.success) {
        throw new EdgeSQLError(
          `Failed to execute D1 query: ${data.errors.map(e => e.message).join(', ')}`,
          'D1_QUERY_ERROR'
        );
      }

      // REST API returns array of results, we return first one
      const result = data.result[0];
      if (!result) {
        throw new EdgeSQLError('No result returned from D1 query', 'D1_QUERY_ERROR');
      }

      this.log('debug', 'Executed D1 query', { 
        databaseId, 
        rowsRead: result.meta.rows_read,
        rowsWritten: result.meta.rows_written,
        duration: result.meta.duration,
      });

      return result;
    });
  }

  /**
   * Execute multiple SQL queries in a batch
   * POST /accounts/{account_id}/d1/database/{database_id}/query
   */
  async batch(
    databaseId: string,
    queries: Array<{ sql: string; params?: unknown[] }>
  ): Promise<D1QueryResult[]> {
    this.validateConfig();

    const url = `${this.baseUrl}/accounts/${this.accountId}/d1/database/${databaseId}/query`;

    return await this.retryWithBackoff(async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(queries),
      });

      const data = await response.json() as D1BatchResult;

      if (!data.success) {
        throw new EdgeSQLError(
          `Failed to execute D1 batch: ${data.errors.map(e => e.message).join(', ')}`,
          'D1_BATCH_ERROR'
        );
      }

      this.log('info', 'Executed D1 batch', { 
        databaseId, 
        queryCount: queries.length,
        resultsCount: data.result.length,
      });

      return data.result;
    });
  }

  /**
   * Sync data from Durable Object shard to D1 database
   * This is used by the d1_sync event handler
   */
  async syncShardToD1(
    databaseId: string,
    shardId: string,
    operations: Array<{ sql: string; params?: unknown[] }>
  ): Promise<void> {
    if (operations.length === 0) {
      this.log('debug', 'No operations to sync', { shardId, databaseId });
      return;
    }

    this.log('info', 'Starting D1 sync', { shardId, databaseId, operationCount: operations.length });

    try {
      const results = await this.batch(databaseId, operations);
      
      const totalChanges = results.reduce((sum, r) => sum + r.meta.changes, 0);
      const totalRowsWritten = results.reduce((sum, r) => sum + r.meta.rows_written, 0);

      this.log('info', 'D1 sync completed', {
        shardId,
        databaseId,
        operationCount: operations.length,
        totalChanges,
        totalRowsWritten,
      });
    } catch (error) {
      this.log('error', 'D1 sync failed', {
        shardId,
        databaseId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Initialize or ensure D1 database exists for a tenant
   */
  async ensureDatabase(name: string): Promise<D1Database> {
    try {
      // Try to find existing database by name
      const databases = await this.listDatabases();
      const existing = databases.find(db => db.name === name);

      if (existing) {
        this.log('debug', 'D1 database already exists', { name, uuid: existing.uuid });
        return existing;
      }

      // Create new database if not found
      this.log('info', 'Creating new D1 database', { name });
      return await this.createDatabase(name);
    } catch (error) {
      this.log('error', 'Failed to ensure D1 database', {
        name,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get request headers with authentication
   */
  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Validate that required configuration is present
   */
  private validateConfig(): void {
    if (!this.accountId) {
      throw new EdgeSQLError(
        'CLOUDFLARE_ACCOUNT_ID environment variable is required',
        'CONFIG_ERROR'
      );
    }

    if (!this.apiToken) {
      throw new EdgeSQLError(
        'CLOUDFLARE_API_TOKEN environment variable is required',
        'CONFIG_ERROR'
      );
    }
  }
}
