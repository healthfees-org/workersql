import { CacheService } from './services/CacheService';
import { ConfigService } from './services/ConfigService';
import { RouterService } from './services/RouterService';
import { CircuitBreakerService } from './services/CircuitBreakerService';
import { ConnectionManager } from './services/ConnectionManager';
import { SQLCompatibilityService } from './services/SQLCompatibilityService';
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
      // Health check endpoint
      if (request.url.endsWith('/health')) {
        return gateway.handleHealthCheck();
      }

      // Metrics endpoint
      if (request.url.endsWith('/metrics')) {
        return gateway.handleMetrics();
      }

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
  private sqlCompatibility: SQLCompatibilityService;
  private _env: CloudflareEnvironment;
  private _ctx: ExecutionContext;

  constructor(env: CloudflareEnvironment, ctx: ExecutionContext) {
    this._env = env;
    this._ctx = ctx;
    this.cacheService = new CacheService(this._env);
    this.configService = new ConfigService(this._env);
    this.routerService = new RouterService(this._env);
    this.breaker = new CircuitBreakerService();
    this.connections = new ConnectionManager();
    this.sqlCompatibility = new SQLCompatibilityService(this._env);
  }

  /**
   * Main request handler - routes SQL requests to appropriate processing pipeline
   */
  async handleRequest(request: Request): Promise<Response> {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();

    try {
      // Log incoming request
      this.logRequest(request, requestId);

      // Rate limiting check
      const rateLimitResult = await this.checkRateLimit(request);
      if (!rateLimitResult.allowed) {
        return new Response('Rate limit exceeded', {
          status: 429,
          headers: {
            'Retry-After': rateLimitResult.retryAfter?.toString() || '60',
            ...this.getCORSHeaders(),
          },
        });
      }

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
        this.log('warn', 'Authentication failed', { requestId });
        return new Response('Unauthorized', {
          status: 401,
          headers: this.getCORSHeaders(),
        });
      }

      // Parse SQL request
      const sqlRequest = await this.parseSQLRequest(request);
      if (!sqlRequest) {
        this.log('warn', 'Invalid SQL request', { requestId });
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
        this.log('warn', 'Unsupported SQL operation', { requestId, type: sqlRequest.type });
        return new Response('Unsupported SQL operation', {
          status: 400,
          headers: this.getCORSHeaders(),
        });
      }

      // Log successful request
      const executionTime = Date.now() - startTime;
      this.log('info', 'Request completed', {
        requestId,
        executionTime,
        tenantId: authResult.tenantId,
        sqlType: sqlRequest.type,
        cached: response.cached,
      });

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
          ...this.getCORSHeaders(),
        },
      });
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.log('error', 'Request failed', {
        requestId,
        executionTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return new Response(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Internal server error',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'X-Request-ID': requestId,
            ...this.getCORSHeaders(),
          },
        }
      );
    }
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    const auth = this.validateAuth(request);
    if (!auth.valid || !auth.tenantId) {
      // Return HTTP 401 for failed authentication instead of WebSocket response
      return new Response('Unauthorized', {
        status: 401,
        headers: this.getCORSHeaders(),
      });
    }

    const { 0: client, 1: server } = new WebSocketPair();

    (server as WebSocket & { accept(): void }).accept();

    // Derive or receive a session id from headers; fallback to random
    const sessionId = request.headers.get('x-session-id') || crypto.randomUUID();
    const transactionId = request.headers.get('x-transaction-id');

    // For initial bind, pick shard based on tenant hash
    const shardId = this.getPrimaryShardForTenant(auth.tenantId);
    this.connections.bindSession(sessionId, auth.tenantId, shardId, transactionId || undefined);

    // Periodic cleanup of stale sessions
    this._ctx.waitUntil(Promise.resolve().then(() => this.connections.cleanup()));

    // Enhanced message protocol: { sql, params, type, action }
    server.addEventListener('message', async (evt: MessageEvent) => {
      try {
        const payload = JSON.parse(evt.data) as {
          sql?: string;
          params?: unknown[];
          action?: 'begin' | 'commit' | 'rollback';
          transactionId?: string;
        };

        // Handle transaction control messages
        if (payload.action) {
          const success = this.handleTransactionAction(
            sessionId,
            payload.action,
            payload.transactionId
          );
          server.send(
            JSON.stringify({
              success,
              action: payload.action,
              transactionId: payload.transactionId,
            })
          );
          return;
        }

        // Handle SQL queries
        if (!payload.sql) {
          server.send(
            JSON.stringify({
              success: false,
              error: 'Missing SQL query',
            })
          );
          return;
        }

        const sqlUpper = payload.sql?.trim().toUpperCase() || '';
        const type: SQLQuery['type'] = sqlUpper.startsWith('SELECT')
          ? 'SELECT'
          : sqlUpper.match(/^(INSERT|UPDATE|DELETE)/)
            ? (sqlUpper.split(' ')[0] as 'INSERT' | 'UPDATE' | 'DELETE')
            : 'DDL';

        const query: SQLQuery = {
          sql: payload.sql,
          params: payload.params || [],
          type,
          tableName: this.extractTableName(payload.sql),
          timestamp: Date.now(),
        };

        const shardInfo = this.connections.getSession(sessionId);
        if (!shardInfo) {
          server.send(
            JSON.stringify({
              success: false,
              error: 'Session not found',
            })
          );
          return;
        }

        const routedShardId = shardInfo.shardId;
        const target = this._env.SHARD.get(this._env.SHARD.idFromName(routedShardId));

        //@FLAG: No internal requests
        const res = await this.breaker.execute(routedShardId, async () =>
          target.fetch(
            new Request(
              'https://internal/' +
                (type === 'SELECT' ? 'query' : type === 'DDL' ? 'ddl' : 'mutation'),
              {
                method: 'POST',
                body: JSON.stringify({
                  query,
                  tenantId: auth.tenantId,
                  transactionId: shardInfo.transactionId,
                }),
              }
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

    return new Response(null, { webSocket: client as unknown as WebSocket });
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

    try {
      // Verify JWT token
      const payload = this.verifyJWT(token);
      if (!payload) {
        return { valid: false };
      }

      // Extract tenant information from JWT claims
      const tenantId = payload['tenant_id'] || payload['sub'] || payload['tenantId'];
      if (!tenantId) {
        return { valid: false };
      }

      // Extract permissions from JWT claims
      const permissions = payload['permissions'] || payload['roles'] || ['read'];

      return {
        valid: true,
        tenantId: String(tenantId),
        permissions: Array.isArray(permissions) ? permissions : [String(permissions)],
      };
    } catch (error) {
      this.log('error', 'JWT validation failed', { error: (error as Error).message });
      return { valid: false };
    }
  }

  /**
   * Verify JWT token and extract payload
   */
  private verifyJWT(token: string): Record<string, unknown> | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }

      const payloadB64 = parts[1];
      if (!payloadB64) {
        throw new Error('Invalid JWT payload');
      }

      // Decode payload (no signature verification for now - in production use proper JWT library)
      const payloadJson = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
      const payload = JSON.parse(payloadJson) as Record<string, unknown>;

      // Basic validation
      const now = Math.floor(Date.now() / 1000);
      if (typeof payload['exp'] === 'number' && payload['exp'] < now) {
        throw new Error('Token expired');
      }

      if (typeof payload['nbf'] === 'number' && payload['nbf'] > now) {
        throw new Error('Token not yet valid');
      }

      return payload;
    } catch (error) {
      this.log('error', 'JWT verification failed', { error: (error as Error).message });
      return null;
    }
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

      // Transpile MySQL SQL to SQLite-compatible SQL
      const { sql: transpiledSQL, hints } = this.sqlCompatibility.transpileSQL(body.sql);

      // Basic SQL type detection
      const type = this.sqlCompatibility.getStatementType(transpiledSQL);

      return {
        sql: transpiledSQL,
        params: body.params || [],
        type,
        tableName: this.sqlCompatibility.extractTableName(transpiledSQL),
        timestamp: Date.now(),
        hints,
      };
    } catch {
      return null;
    }
  }

  /**
   * Extract table name from SQL for shard routing
   */
  private extractTableName(sql: string): string {
    // Improved table name extraction with better SQL parsing
    const upperSQL = sql.toUpperCase();

    // Handle different SQL statement types
    const patterns = [
      // SELECT statements
      /\bFROM\s+`?(\w+)`?/i,
      /\bJOIN\s+`?(\w+)`?/i,

      // INSERT statements
      /\bINTO\s+`?(\w+)`?/i,

      // UPDATE statements
      /\bUPDATE\s+`?(\w+)`?/i,

      // DELETE statements
      /\bFROM\s+`?(\w+)`?/i,

      // DDL statements
      /\bTABLE\s+`?(\w+)`?/i,
      /\bINDEX\s+`?(\w+)`?/i,
    ];

    for (const pattern of patterns) {
      const match = upperSQL.match(pattern);
      if (match && match[1]) {
        return match[1].toLowerCase();
      }
    }

    // Fallback: extract any word that looks like a table name
    const fallbackMatch = sql.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/);
    return fallbackMatch && fallbackMatch[1] ? fallbackMatch[1].toLowerCase() : 'unknown';
  }

  /**
   * Handle SELECT queries with caching and shard routing
   */
  private async handleSelect(query: SQLQuery, tenantId: string): Promise<WorkerResponse> {
    // Check materialized query cache first
    const cached = await this.cacheService.getMaterialized(
      tenantId,
      query.tableName,
      query.sql,
      query.params
    );
    if (cached) {
      return {
        success: true,
        data: cached.data,
        cached: true,
        executionTime: 0,
      };
    }

    const startTime = Date.now();

    // Route to appropriate shard using RouterService
    const queryRequest: QueryRequest = {
      sql: query.sql,
      params: query.params,
      ...(query.hints && { hints: query.hints }),
    };
    const targetInfo = await this.routerService.routeQuery(queryRequest, tenantId);
    const shardId = targetInfo.shardId;
    const shard = this._env.SHARD.get(targetInfo.durableObjectId);

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

    // Cache the result as a materialized query
    this._ctx.waitUntil(
      this.cacheService.setMaterialized(
        tenantId,
        query.tableName,
        query.sql,
        query.params,
        data.data,
        {
          ttlMs: this.configService.getCacheTTL(),
          swrMs: this.configService.getCacheSWR(),
        }
      )
    );

    return {
      success: true,
      data: data.data,
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
    const queryRequest: QueryRequest = {
      sql: query.sql,
      params: query.params,
      ...(query.hints && { hints: query.hints }),
    };
    const targetInfo = await this.routerService.routeQuery(queryRequest, tenantId);
    const shardId = targetInfo.shardId;
    const shard = this._env.SHARD.get(targetInfo.durableObjectId);

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
    this._ctx.waitUntil(
      Promise.all([
        this.invalidateCache(tenantId, query.tableName),
        this._env.DB_EVENTS.send({
          type: 'cache_invalidation',
          tenantId,
          tableName: query.tableName,
          timestamp: Date.now(),
        }),
      ])
    );

    return {
      success: true,
      data: data.data,
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
    const shard = this._env.SHARD.get(this._env.SHARD.idFromName(primaryShardId));

    const result = await this.breaker.execute(primaryShardId, () =>
      shard.fetch(
        new Request('https://internal/ddl', {
          method: 'POST',
          body: JSON.stringify({
            query: {
              sql: query.sql,
              params: query.params,
              ...(query.hints && { hints: query.hints }),
            },
            tenantId,
          }),
        })
      )
    );

    const data = await result.json<WorkerResponse>();
    const executionTime = Date.now() - startTime;

    // Invalidate all cache for tenant on DDL changes
    this._ctx.waitUntil(this.invalidateAllCache(tenantId));

    return {
      success: true,
      data: data.data,
      cached: false,
      executionTime,
    };
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
    const pattern = `${tenantId}:q:${tableName}:*`;
    return this.cacheService.deleteByPattern(pattern);
  }

  /**
   * Invalidate all cache entries for a tenant
   */
  private invalidateAllCache(tenantId: string): Promise<void> {
    const pattern = `${tenantId}:q:*`;
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
   * Handle transaction control actions (BEGIN, COMMIT, ROLLBACK)
   */
  private handleTransactionAction(
    sessionId: string,
    action: 'begin' | 'commit' | 'rollback',
    transactionId?: string
  ): boolean {
    switch (action) {
      case 'begin':
        if (!transactionId) {
          transactionId = crypto.randomUUID();
        }
        return this.connections.startTransaction(sessionId, transactionId);

      case 'commit':
      case 'rollback':
        return this.connections.endTransaction(sessionId);

      default:
        return false;
    }
  }

  /**
   * Get CORS headers for responses
   */
  private getCORSHeaders(): Record<string, string> {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Session-Id, X-Transaction-Id',
      'Access-Control-Max-Age': '86400',
    };
  }

  /**
   * Log incoming request details
   */
  public logRequest(request: Request, requestId: string): void {
    this.log(
      'info',
      `[${requestId}] ${request.method} ${request.url} - ${new Date().toISOString()}`
    );
  }

  /**
   * Check rate limiting for the request
   */
  public async checkRateLimit(request: Request): Promise<{
    allowed: boolean;
    retryAfter?: number;
  }> {
    // Basic rate limiting implementation
    // In production, this should use a more sophisticated rate limiting mechanism
    const clientIP =
      request.headers.get('CF-Connecting-IP') ||
      request.headers.get('X-Forwarded-For') ||
      'unknown';

    const key = `ratelimit:${clientIP}`;
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const maxRequests = 100; // 100 requests per minute

    try {
      // Get current request count from cache
      const currentCount = (await this._env.APP_CACHE.get(key, 'json')) as {
        count: number;
        resetTime: number;
      } | null;

      if (!currentCount || currentCount.resetTime < now) {
        // Reset window
        await this._env.APP_CACHE.put(
          key,
          JSON.stringify({
            count: 1,
            resetTime: now + windowMs,
          }),
          { expirationTtl: windowMs / 1000 }
        );

        return { allowed: true };
      }

      if (currentCount.count >= maxRequests) {
        return {
          allowed: false,
          retryAfter: Math.ceil((currentCount.resetTime - now) / 1000),
        };
      }

      // Increment count
      await this._env.APP_CACHE.put(
        key,
        JSON.stringify({
          count: currentCount.count + 1,
          resetTime: currentCount.resetTime,
        }),
        { expirationTtl: Math.ceil((currentCount.resetTime - now) / 1000) }
      );

      return { allowed: true };
    } catch (error) {
      // If rate limiting fails, allow the request
      this.log('warn', 'Rate limiting check failed', { error: (error as Error).message });
      return { allowed: true };
    }
  }

  /**
   * Log message with structured data
   */
  public log(
    level: 'info' | 'warn' | 'error',
    message: string,
    data?: Record<string, unknown>
  ): void {
    const logEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...data,
    };

    if (level === 'error') {
      console.error(JSON.stringify(logEntry));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(logEntry));
    }
  }

  /**
   * Handle health check requests
   */
  public handleHealthCheck(): Response {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      uptime: 0, // Cloudflare Workers don't have process.uptime
    };

    return new Response(JSON.stringify(health), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Handle metrics requests
   */
  public handleMetrics(): Response {
    const metrics = {
      timestamp: new Date().toISOString(),
      connections: {
        active: this.connections ? this.connections.getActiveSessions().length : 0,
        inTransaction: this.connections ? this.connections.getTransactionSessions().length : 0,
      },
      cache: {
        // @TODO: Cache metrics would be collected from CacheService
        status: 'operational',
      },
      shards: {
        // @TODO: Shard health metrics would be collected from RouterService
        status: 'operational',
      },
    };

    return new Response(JSON.stringify(metrics), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Export Durable Object classes for Wrangler
export { TableShard } from './services/TableShard';
