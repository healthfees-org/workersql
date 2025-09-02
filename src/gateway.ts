import { CacheService } from './services/CacheService';
import { ConfigService } from './services/ConfigService';
import { RouterService } from './services/RouterService';
import { CircuitBreakerService } from './services/CircuitBreakerService';
import { ConnectionManager } from './services/ConnectionManager';
import { WorkerResponse, SQLQuery, CloudflareEnvironment, QueryRequest } from './types';

/**
 * Main gateway worker entry point for Edge SQL
 * Handles MySQL-compatible SQL requests and routes them to appropriate shards
 */
export default {
  async fetch(
    request: Request,
    env: CloudflareEnvironment,
    ctx: ExecutionContext
  ): Promise<Response> {
    const gateway = new EdgeSQLGateway(env, ctx);
    try {
      return await gateway.handleRequest(request);
    } catch (error) {
      console.error('Gateway error:', error);
      return new Response('Internal Server Error', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  },
};

/**
 * Core gateway class that orchestrates SQL request processing
 */
export class EdgeSQLGateway {
  private cacheService: CacheService;
  private configService: ConfigService;
  private routerService: RouterService;
  private breaker: CircuitBreakerService;
  private connections: ConnectionManager;

  constructor(
    private env: CloudflareEnvironment,
    private ctx: ExecutionContext
  ) {
    this.cacheService = new CacheService(this.env);
    this.configService = new ConfigService(this.env);
    this.routerService = new RouterService(this.env);
    this.breaker = new CircuitBreakerService();
    this.connections = new ConnectionManager();
  }

  /**
   * Main request handler - routes SQL requests to appropriate processing pipeline
   */
  async handleRequest(request: Request): Promise<Response> {
    // CORS handling
    if (request.method === 'OPTIONS') {
      return this.handleCORS();
    }

    // Basic WebSocket upgrade handling for sticky sessions
    const upgrade = request.headers.get('Upgrade') || '';
    if (upgrade.toLowerCase() === 'websocket') {
      return this.handleWebSocket(request);
    }

    // Authentication and tenant validation
    const authResult = this.validateAuth(request);
    if (!authResult.valid || !authResult.tenantId) {
      return new Response('Unauthorized', {
        status: 401,
        headers: this.getCORSHeaders(),
      });
    }

    // Parse SQL request
    const sqlRequest = await this.parseSQLRequest(request);
    if (!sqlRequest) {
      return new Response('Invalid SQL request', {
        status: 400,
        headers: this.getCORSHeaders(),
      });
    }

    // Route to appropriate handler based on SQL type
    let response: WorkerResponse;

    if (sqlRequest.type === 'SELECT') {
      response = await this.handleSelect(sqlRequest, authResult.tenantId);
    } else if (['INSERT', 'UPDATE', 'DELETE'].includes(sqlRequest.type)) {
      response = await this.handleMutation(sqlRequest, authResult.tenantId);
    } else if (sqlRequest.type === 'DDL') {
      response = await this.handleDDL(sqlRequest, authResult.tenantId);
    } else {
      return new Response('Unsupported SQL operation', {
        status: 400,
        headers: this.getCORSHeaders(),
      });
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...this.getCORSHeaders(),
      },
    });
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();

    const auth = this.validateAuth(request);
    if (!auth.valid || !auth.tenantId) {
      // Immediately close with 1008 policy violation
      (server as any).close(1008, 'Unauthorized');
      return new Response(null, { status: 101, webSocket: client } as any);
    }

    (server as any).accept();

    // Derive or receive a session id from headers; fallback to random
    const sessionId = request.headers.get('x-session-id') || crypto.randomUUID();

    // For initial bind, pick shard based on tenant hash
    const shardId = this.getPrimaryShardForTenant(auth.tenantId);
    this.connections.bindSession(sessionId, auth.tenantId, shardId);

    // Periodic cleanup of stale sessions
    this.ctx.waitUntil(Promise.resolve().then(() => this.connections.cleanup()));

    // Simple message protocol: { sql, params, type }
    server.addEventListener('message', async (evt: MessageEvent) => {
      try {
        const payload = JSON.parse(String(evt.data)) as { sql: string; params?: unknown[] };
        const sqlUpper = payload.sql?.trim().toUpperCase() || '';
        const type: SQLQuery['type'] = sqlUpper.startsWith('SELECT')
          ? 'SELECT'
          : sqlUpper.match(/^(INSERT|UPDATE|DELETE)/)
            ? (sqlUpper.split(' ')[0] as any)
            : 'DDL';
        const query: SQLQuery = {
          sql: payload.sql,
          params: payload.params || [],
          type,
          tableName: this.extractTableName(payload.sql),
          timestamp: Date.now(),
        };

        const shardInfo = this.connections.getSession(sessionId);
        const routedShardId =
          shardInfo?.shardId || this.getShardForTable(auth.tenantId!, query.tableName);
        const target = this.env.SHARD.get(this.env.SHARD.idFromName(routedShardId));

        const res = await this.breaker.execute(routedShardId, async () =>
          target.fetch(
            new Request(
              'https://internal/' +
                (type === 'SELECT' ? 'query' : type === 'DDL' ? 'ddl' : 'mutation'),
              { method: 'POST', body: JSON.stringify({ query, tenantId: auth.tenantId }) }
            )
          )
        );
        const data = (await res.json()) as WorkerResponse;
        server.send(JSON.stringify({ success: true, data }));
      } catch (err) {
        server.send(
          JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          })
        );
      }
    });

    server.addEventListener('close', () => {
      this.connections.releaseSession(sessionId);
    });

    return new Response(null, { status: 101, webSocket: client } as any);
  }

  /**
   * Validate authentication token and extract tenant information
   */
  private validateAuth(request: Request): {
    valid: boolean;
    tenantId?: string;
    permissions?: string[];
  } {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return { valid: false };
    }

    const token = authHeader.substring(7);

    // TODO: Implement proper JWT validation with tenant extraction
    // For now, basic validation
    if (token.length < 10) {
      return { valid: false };
    }

    // Extract tenant from token (placeholder implementation)
    const tenantId = 'tenant_' + token.substring(0, 8);

    return {
      valid: true,
      tenantId,
      permissions: ['read', 'write'], // TODO: Extract from JWT
    };
  }

  /**
   * Parse incoming request into SQL query structure
   */
  private async parseSQLRequest(request: Request): Promise<SQLQuery | null> {
    try {
      const body = await request.json<{ sql: string; params?: unknown[] }>();

      if (!body.sql || typeof body.sql !== 'string') {
        return null;
      }

      // Basic SQL type detection
      const sqlUpper = body.sql.trim().toUpperCase();
      let type: SQLQuery['type'];

      if (sqlUpper.startsWith('SELECT')) {
        type = 'SELECT';
      } else if (sqlUpper.startsWith('INSERT')) {
        type = 'INSERT';
      } else if (sqlUpper.startsWith('UPDATE')) {
        type = 'UPDATE';
      } else if (sqlUpper.startsWith('DELETE')) {
        type = 'DELETE';
      } else if (sqlUpper.match(/^(CREATE|ALTER|DROP|TRUNCATE)/)) {
        type = 'DDL';
      } else {
        return null;
      }

      return {
        sql: body.sql,
        params: body.params || [],
        type,
        tableName: this.extractTableName(body.sql),
        timestamp: Date.now(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Extract table name from SQL for shard routing
   */
  private extractTableName(sql: string): string {
    // Simple table name extraction - TODO: Improve with proper SQL parsing
    const match = sql.match(
      /(?:FROM|INTO|UPDATE|CREATE TABLE|ALTER TABLE|DROP TABLE)\s+`?(\w+)`?/i
    );
    return match?.[1] || 'unknown';
  }

  /**
   * Handle SELECT queries with caching and shard routing
   */
  private async handleSelect(query: SQLQuery, tenantId: string): Promise<WorkerResponse> {
    const cacheKey = `${tenantId}:${query.tableName}:${JSON.stringify(query)}`;

    // Check cache first
    const cached = await this.cacheService.get(cacheKey);
    if (cached) {
      return {
        success: true,
        data: cached,
        cached: true,
        executionTime: 0,
      };
    }

    const startTime = Date.now();

    // Route to appropriate shard using RouterService
    const queryRequest: QueryRequest = { sql: query.sql } as QueryRequest;
    const targetInfo = await this.routerService.routeQuery(queryRequest, tenantId);
    const shardId = targetInfo.shardId;
    const shard = this.env.SHARD.get(targetInfo.durableObjectId);

    const result = await this.breaker.execute(shardId, () =>
      shard.fetch(
        new Request('https://internal/query', {
          method: 'POST',
          body: JSON.stringify({ query, tenantId }),
        })
      )
    );

    const data = await result.json<WorkerResponse>();
    const executionTime = Date.now() - startTime;

    // Cache the result
    this.ctx.waitUntil(
      this.cacheService.set(cacheKey, data, {
        ttlMs: this.configService.getCacheTTL(),
        swrMs: this.configService.getCacheSWR(),
      })
    );

    return {
      success: true,
      data,
      cached: false,
      executionTime,
    };
  }

  /**
   * Handle INSERT, UPDATE, DELETE operations
   */
  private async handleMutation(query: SQLQuery, tenantId: string): Promise<WorkerResponse> {
    const startTime = Date.now();

    // Route to appropriate shard using RouterService
    const queryRequest: QueryRequest = { sql: query.sql } as QueryRequest;
    const targetInfo = await this.routerService.routeQuery(queryRequest, tenantId);
    const shardId = targetInfo.shardId;
    const shard = this.env.SHARD.get(targetInfo.durableObjectId);

    const result = await this.breaker.execute(shardId, () =>
      shard.fetch(
        new Request('https://internal/mutation', {
          method: 'POST',
          body: JSON.stringify({ query, tenantId }),
        })
      )
    );

    const data = await result.json<WorkerResponse>();
    const executionTime = Date.now() - startTime;

    // Invalidate related cache entries and send queue event
    this.ctx.waitUntil(
      Promise.all([
        this.invalidateCache(tenantId, query.tableName),
        this.env.DB_EVENTS.send({
          type: 'cache_invalidation',
          tenantId,
          tableName: query.tableName,
          timestamp: Date.now(),
        }),
      ])
    );

    return {
      success: true,
      data,
      cached: false,
      executionTime,
    };
  }

  /**
   * Handle DDL operations (CREATE, ALTER, DROP, etc.)
   */
  private async handleDDL(query: SQLQuery, tenantId: string): Promise<WorkerResponse> {
    const startTime = Date.now();

    // DDL operations may affect multiple shards, route to primary shard
    const primaryShardId = this.getPrimaryShardForTenant(tenantId);
    const shard = this.env.SHARD.get(this.env.SHARD.idFromName(primaryShardId));

    const result = await this.breaker.execute(primaryShardId, () =>
      shard.fetch(
        new Request('https://internal/ddl', {
          method: 'POST',
          body: JSON.stringify({ query, tenantId }),
        })
      )
    );

    const data = await result.json<WorkerResponse>();
    const executionTime = Date.now() - startTime;

    // Invalidate all cache for tenant on DDL changes
    this.ctx.waitUntil(this.invalidateAllCache(tenantId));

    return {
      success: true,
      data,
      cached: false,
      executionTime,
    };
  }

  /**
   * Determine which shard should handle a specific table for a tenant
   */
  private getShardForTable(tenantId: string, tableName: string): string {
    // Simple hash-based sharding for now
    const shardHash = this.hashString(`${tenantId}:${tableName}`);
    const shardCount = this.configService.getShardCount();
    const shardIndex = shardHash % shardCount;
    return `shard_${shardIndex}`;
  }

  /**
   * Get primary shard for a tenant (for DDL operations)
   */
  private getPrimaryShardForTenant(tenantId: string): string {
    const shardHash = this.hashString(tenantId);
    const shardCount = this.configService.getShardCount();
    const shardIndex = shardHash % shardCount;
    return `shard_${shardIndex}`;
  }

  /**
   * Simple string hashing for shard selection
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Invalidate cache entries for a specific table
   */
  private invalidateCache(tenantId: string, tableName: string): Promise<void> {
    const pattern = `${tenantId}:${tableName}:*`;
    return this.cacheService.deleteByPattern(pattern);
  }

  /**
   * Invalidate all cache entries for a tenant
   */
  private invalidateAllCache(tenantId: string): Promise<void> {
    const pattern = `${tenantId}:*`;
    return this.cacheService.deleteByPattern(pattern);
  }

  /**
   * Handle CORS preflight requests
   */
  private handleCORS(): Response {
    return new Response(null, {
      status: 204,
      headers: this.getCORSHeaders(),
    });
  }

  /**
   * Get CORS headers for responses
   */
  private getCORSHeaders(): Record<string, string> {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };
  }
}
