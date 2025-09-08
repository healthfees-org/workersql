import {
  QueryRequest,
  QueryResult,
  ConnectionState,
  EdgeSQLError,
  ShardCapacityError,
  DatabaseEvent,
  CloudflareEnvironment,
} from '../types';

/**
 * TableShard - Durable Object implementing MySQL-compatible storage shard
 *
 * Each shard handles:
 * - Table data persistence (in-memory with periodic D1 sync)
 * - Transaction management
 * - Tenant isolation
 * - Capacity monitoring
 * - Event emission for cache invalidation
 */
export class TableShard implements DurableObject {
  private storage: DurableObjectStorage;
  private env: CloudflareEnvironment;
  private initializePromise?: Promise<void>;

  // In-memory table data for fast access
  private tables: Map<string, Map<string, Record<string, unknown>>> = new Map();

  // Active connections and transactions
  private connections: Map<string, ConnectionState> = new Map();
  private transactions: Map<
    string,
    {
      operations: Array<{ sql: string; params: unknown[] }>;
      tenantId: string;
      startTime: number;
    }
  > = new Map();

  // Capacity tracking
  private currentSizeBytes: number = 0;
  private lastSyncTimestamp: number = 0;

  // Event emission queue
  private pendingEvents: DatabaseEvent[] = [];

  constructor(state: DurableObjectState, env: CloudflareEnvironment) {
    this.storage = state.storage;
    this.env = env;
  }

  /**
   * Handle all HTTP requests to this shard
   */
  async fetch(request: Request): Promise<Response> {
    try {
      await this.ensureInitialized();

      const url = new URL(request.url);
      const path = url.pathname;

      switch (path) {
        case '/query':
          return this.handleQuery(request);
        case '/mutation':
          return this.handleMutation(request);
        case '/ddl':
          return this.handleDDL(request);
        case '/transaction':
          return this.handleTransaction(request);
        case '/health':
          return this.handleHealth();
        case '/metrics':
          return this.handleMetrics();
        default:
          return new Response('Not Found', { status: 404 });
      }
    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  /**
   * Lazy initialization of shard state
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.initialize();
    }
    return this.initializePromise;
  }

  /**
   * Initialize shard by loading persisted state
   */
  private async initialize(): Promise<void> {
    // Load table schemas and data from durable storage
    const tableNames = await this.storage.list<string>({ prefix: 'table:' });

    for (const [key] of tableNames) {
      const tableName = key.substring(6); // Remove 'table:' prefix
      const tableData = await this.storage.get<Map<string, Record<string, unknown>>>(key);

      if (tableData) {
        this.tables.set(tableName, new Map(tableData));
      }
    }

    // Load capacity metrics
    this.currentSizeBytes = (await this.storage.get<number>('capacity:size')) || 0;
    this.lastSyncTimestamp = (await this.storage.get<number>('sync:timestamp')) || 0;

    // Schedule periodic sync to D1
    this.schedulePeriodicSync();
  }

  /**
   * Handle SELECT queries
   */
  private async handleQuery(request: Request): Promise<Response> {
    const { query, tenantId } = (await request.json()) as {
      query: QueryRequest;
      tenantId: string;
    };

    this.validateTenantAccess(tenantId, query.sql);

    const result = await this.executeQuery(query, tenantId);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Handle INSERT, UPDATE, DELETE operations
   */
  private async handleMutation(request: Request): Promise<Response> {
    const { query, tenantId } = (await request.json()) as {
      query: QueryRequest;
      tenantId: string;
    };

    this.validateTenantAccess(tenantId, query.sql);
    this.checkCapacity();

    const result = await this.executeMutation(query, tenantId);

    // Emit cache invalidation event
    await this.emitInvalidationEvent(tenantId, this.extractTableName(query.sql));

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Handle DDL operations (CREATE, ALTER, DROP, etc.)
   */
  private async handleDDL(request: Request): Promise<Response> {
    const { query, tenantId } = (await request.json()) as {
      query: QueryRequest;
      tenantId: string;
    };

    this.validateTenantAccess(tenantId, query.sql);

    const result = await this.executeDDL(query, tenantId);

    // DDL operations invalidate all cache for the tenant
    await this.emitInvalidationEvent(tenantId, '*');

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Handle transaction operations (BEGIN, COMMIT, ROLLBACK)
   */
  private async handleTransaction(request: Request): Promise<Response> {
    const { operation, transactionId, tenantId } = (await request.json()) as {
      operation: 'BEGIN' | 'COMMIT' | 'ROLLBACK';
      transactionId?: string;
      tenantId: string;
    };

    let result: QueryResult;

    switch (operation) {
      case 'BEGIN':
        result = await this.beginTransaction(tenantId);
        break;
      case 'COMMIT':
        if (!transactionId) {
          throw new EdgeSQLError('Transaction ID required', 'INVALID_TRANSACTION');
        }
        result = await this.commitTransaction(transactionId);
        break;
      case 'ROLLBACK':
        if (!transactionId) {
          throw new EdgeSQLError('Transaction ID required', 'INVALID_TRANSACTION');
        }
        result = await this.rollbackTransaction(transactionId);
        break;
      default:
        throw new EdgeSQLError('Invalid transaction operation', 'INVALID_OPERATION');
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Health check endpoint
   */
  private handleHealth(): Response {
    return new Response(
      JSON.stringify({
        status: 'healthy',
        sizeBytes: this.currentSizeBytes,
        tables: this.tables.size,
        connections: this.connections.size,
        transactions: this.transactions.size,
        lastSync: this.lastSyncTimestamp,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  /**
   * Metrics endpoint for monitoring
   */
  private handleMetrics(): Response {
    const metrics = {
      shard_size_bytes: this.currentSizeBytes,
      shard_tables_count: this.tables.size,
      shard_connections_active: this.connections.size,
      shard_transactions_active: this.transactions.size,
      shard_last_sync_timestamp: this.lastSyncTimestamp,
      shard_pending_events: this.pendingEvents.length,
    };

    return new Response(JSON.stringify(metrics), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Execute SELECT query
   */
  private async executeQuery(query: QueryRequest, tenantId: string): Promise<QueryResult> {
    const tableName = this.extractTableName(query.sql);
    const table = this.tables.get(`${tenantId}:${tableName}`);

    if (!table) {
      return { rows: [] };
    }

    // Simple query execution - TODO: Implement proper SQL parsing
    const rows = Array.from(table.values());

    return {
      rows,
      metadata: {
        fromCache: false,
        shardId: this.getShardId(),
        executionTimeMs: 1, // Placeholder
      },
    };
  }

  /**
   * Execute INSERT, UPDATE, DELETE operations
   */
  private async executeMutation(query: QueryRequest, tenantId: string): Promise<QueryResult> {
    const tableName = this.extractTableName(query.sql);
    const tableKey = `${tenantId}:${tableName}`;

    if (!this.tables.has(tableKey)) {
      this.tables.set(tableKey, new Map());
    }

    const table = this.tables.get(tableKey)!;
    const sql = query.sql.trim().toUpperCase();

    let rowsAffected = 0;
    let insertId: number | undefined;

    if (sql.startsWith('INSERT')) {
      // Simple INSERT implementation
      const id = Date.now().toString();
      table.set(id, { id, ...this.parseInsertValues(query.sql, query.params) });
      rowsAffected = 1;
      insertId = parseInt(id);
    } else if (sql.startsWith('UPDATE')) {
      // Simple UPDATE implementation
      for (const [key, row] of table) {
        table.set(key, { ...row, ...this.parseUpdateValues(query.sql, query.params) });
        rowsAffected++;
      }
    } else if (sql.startsWith('DELETE')) {
      // Simple DELETE implementation
      const originalSize = table.size;
      table.clear(); // Simple clear all - TODO: Implement WHERE clause
      rowsAffected = originalSize;
    }

    // Persist to durable storage
    await this.storage.put(`table:${tableName}`, Array.from(table.entries()));
    this.updateCapacity();

    return {
      rows: [],
      rowsAffected,
      ...(insertId !== undefined && { insertId }),
      metadata: {
        shardId: this.getShardId(),
        executionTimeMs: 1,
      },
    };
  }

  /**
   * Execute DDL operations
   */
  private async executeDDL(query: QueryRequest, tenantId: string): Promise<QueryResult> {
    const sql = query.sql.trim().toUpperCase();
    const tableName = this.extractTableName(query.sql);
    const tableKey = `${tenantId}:${tableName}`;

    if (sql.startsWith('CREATE TABLE')) {
      if (!this.tables.has(tableKey)) {
        this.tables.set(tableKey, new Map());
        await this.storage.put(`table:${tableName}`, []);
      }
    } else if (sql.startsWith('DROP TABLE')) {
      if (this.tables.has(tableKey)) {
        this.tables.delete(tableKey);
        await this.storage.delete(`table:${tableName}`);
      }
    }

    this.updateCapacity();

    return {
      rows: [],
      rowsAffected: 0,
      metadata: {
        shardId: this.getShardId(),
        executionTimeMs: 1,
      },
    };
  }

  /**
   * Begin a new transaction
   */
  private async beginTransaction(tenantId: string): Promise<QueryResult> {
    const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.transactions.set(transactionId, {
      operations: [],
      tenantId,
      startTime: Date.now(),
    });

    return {
      rows: [{ transactionId }],
      metadata: {
        shardId: this.getShardId(),
      },
    };
  }

  /**
   * Commit a transaction
   */
  private async commitTransaction(transactionId: string): Promise<QueryResult> {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) {
      throw new EdgeSQLError('Transaction not found', 'TRANSACTION_NOT_FOUND');
    }

    // Execute all operations in transaction
    // TODO: Implement proper transaction rollback on failure
    for (const operation of transaction.operations) {
      await this.executeMutation(
        {
          sql: operation.sql,
          params: operation.params,
        },
        transaction.tenantId
      );
    }

    this.transactions.delete(transactionId);

    return {
      rows: [],
      rowsAffected: transaction.operations.length,
      metadata: {
        shardId: this.getShardId(),
      },
    };
  }

  /**
   * Rollback a transaction
   */
  private async rollbackTransaction(transactionId: string): Promise<QueryResult> {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) {
      throw new EdgeSQLError('Transaction not found', 'TRANSACTION_NOT_FOUND');
    }

    this.transactions.delete(transactionId);

    return {
      rows: [],
      rowsAffected: 0,
      metadata: {
        shardId: this.getShardId(),
      },
    };
  }

  /**
   * Validate tenant access to prevent cross-tenant data access
   */
  private validateTenantAccess(tenantId: string, _sql: string): void {
    // TODO: Implement proper tenant validation
    if (!tenantId || tenantId.trim() === '') {
      throw new EdgeSQLError('Tenant ID required', 'UNAUTHORIZED');
    }
  }

  /**
   * Check shard capacity before mutations
   */
  private checkCapacity(): void {
    const maxSizeBytes = parseInt(this.env.MAX_SHARD_SIZE_GB) * 1024 * 1024 * 1024;
    if (this.currentSizeBytes >= maxSizeBytes) {
      throw new ShardCapacityError(this.getShardId(), this.currentSizeBytes, maxSizeBytes);
    }
  }

  /**
   * Update capacity metrics
   */
  private updateCapacity(): void {
    // Simple size calculation - TODO: Improve accuracy
    this.currentSizeBytes = JSON.stringify(Array.from(this.tables.entries())).length;
    // Fire-and-forget persistence is acceptable here because capacity metrics are
    // advisory and eventual consistency is fine. Use void to satisfy no-floating-promises.
    void this.storage.put('capacity:size', this.currentSizeBytes);
  }

  /**
   * Extract table name from SQL
   */
  private extractTableName(sql: string): string {
    const match = sql.match(
      /(?:FROM|INTO|UPDATE|CREATE TABLE|ALTER TABLE|DROP TABLE)\s+`?(\w+)`?/i
    );
    return match?.[1] || 'unknown';
  }

  /**
   * Parse INSERT values (simplified)
   */
  private parseInsertValues(_sql: string, params?: unknown[]): Record<string, unknown> {
    // TODO: Implement proper SQL parsing
    return { data: JSON.stringify(params || []) };
  }

  /**
   * Parse UPDATE values (simplified)
   */
  private parseUpdateValues(_sql: string, params?: unknown[]): Record<string, unknown> {
    // TODO: Implement proper SQL parsing
    return { updated_at: Date.now(), data: JSON.stringify(params || []) };
  }

  /**
   * Get shard identifier
   */
  private getShardId(): string {
    // TODO: Get actual shard ID from environment or state
    return 'shard_unknown';
  }

  /**
   * Emit cache invalidation event
   */
  private async emitInvalidationEvent(tenantId: string, tableName: string): Promise<void> {
    const event: DatabaseEvent = {
      type: 'invalidate',
      shardId: this.getShardId(),
      version: Date.now(),
      timestamp: Date.now(),
      keys: [`${tenantId}:${tableName}`],
    };

    this.pendingEvents.push(event);

    // Send to queue if available
    if (this.env.DB_EVENTS) {
      try {
        await this.env.DB_EVENTS.send(event);
        this.pendingEvents = this.pendingEvents.filter((e) => e !== event);
      } catch (e) {
        const error = e as Error;
        // eslint-disable-next-line no-console
        console.error(
          `Failed to send invalidation event for shard ${this.getShardId()}: ${error.message}`
        );
      }
    }
  }

  /**
   * Schedule periodic sync to D1 database
   */
  private schedulePeriodicSync(): void {
    // Schedule sync every 5 minutes
    const syncInterval = 5 * 60 * 1000;

    setInterval(async () => {
      try {
        await this.syncToD1();
      } catch (error) {
        console.error(
          `Periodic sync failed for shard ${this.getShardId()}: ${(error as Error).message}`
        );
      }
    }, syncInterval);
  }

  /**
   * Sync in-memory data to D1 database for durability
   */
  private async syncToD1(): Promise<void> {
    if (!this.env.PORTABLE_DB) {
      return;
    }

    try {
      // TODO: Implement efficient incremental sync
      // For now, just update timestamp
      this.lastSyncTimestamp = Date.now();
      await this.storage.put('sync:timestamp', this.lastSyncTimestamp);
    } catch (e) {
      const error = e as Error;
      // eslint-disable-next-line no-console
      console.error(`D1 sync failed for shard ${this.getShardId()}: ${error.message}`);
      throw error;
    }
  }
}
