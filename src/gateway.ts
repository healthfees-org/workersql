import { CacheService } from './services/CacheService';
import { ConfigService } from './services/ConfigService';
import { RouterService } from './services/RouterService';
import { CircuitBreakerService } from './services/CircuitBreakerService';
import { ConnectionManager } from './services/ConnectionManager';
import { SQLCompatibilityService } from './services/SQLCompatibilityService';
import { ShardSplitService } from './services/ShardSplitService';
import {
  WorkerResponse,
  SQLQuery,
  CloudflareEnvironment,
  QueryRequest,
  EdgeSQLError,
} from './types';
import { queueConsumer } from './services/QueueEventSystem';
import { Logger } from './services/Logger';

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
    const url = new URL(request.url);
    try {
      // Health check endpoint
      if (request.url.endsWith('/health')) {
        return gateway.handleHealthCheck();
      }

      // Metrics endpoint
      if (request.url.endsWith('/metrics')) {
        return gateway.handleMetrics();
      }

      // Admin GraphQL analytics proxy
      if (request.url.endsWith('/admin/graphql')) {
        return gateway.handleAdminGraphQL(request);
      }

      if (url.pathname.startsWith('/admin/shards')) {
        return gateway.handleShardAdmin(request, url);
      }

      // Batch SQL endpoint
      if (request.url.endsWith('/sql/batch') || request.url.endsWith('/batch')) {
        return gateway.handleBatch(request);
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
  // Queue consumer entrypoint for Cloudflare Queues
  async queue(batch: MessageBatch, env: CloudflareEnvironment, _ctx: ExecutionContext) {
    await queueConsumer(batch, env);
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
  private _stubCache: Map<string, DurableObjectStub> = new Map();
  private logger: Logger;
  private shardSplitService: ShardSplitService;

  constructor(env: CloudflareEnvironment, ctx: ExecutionContext) {
    this._env = env;
    this._ctx = ctx;
    this.cacheService = new CacheService(this._env);
    this.configService = new ConfigService(this._env);
    this.routerService = new RouterService(this._env);
    this.breaker = new CircuitBreakerService();
    this.connections = new ConnectionManager();
    this.sqlCompatibility = new SQLCompatibilityService(this._env);
    this.shardSplitService = new ShardSplitService(this._env, this.configService);
    this._ctx.waitUntil(this.shardSplitService.initialize());
    const evars = env as unknown as Record<string, unknown>;
    const envStr = typeof evars['ENVIRONMENT'] === 'string' ? (evars['ENVIRONMENT'] as string) : '';
    this.logger = new Logger({ service: 'Gateway' }, { environment: envStr });
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
              'http://do/' + (type === 'SELECT' ? 'query' : type === 'DDL' ? 'ddl' : 'mutation'),
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
   * Handle batch mutations across one or more shards
   */
  public async handleBatch(request: Request): Promise<Response> {
    const auth = this.validateAuth(request);
    if (!auth.valid || !auth.tenantId) {
      return new Response('Unauthorized', { status: 401, headers: this.getCORSHeaders() });
    }
    const tenantId = auth.tenantId;

    // Configurable guards
    const evars = this._env as unknown as Record<string, unknown>;
    const MAX_OPS = Number((evars['BATCH_MAX_OPS'] ?? 500) as number);
    const MAX_BYTES = Number((evars['BATCH_MAX_BYTES'] ?? 1_048_576) as number); // 1 MiB

    // Read body once to compute size and parse JSON
    let raw = '';
    try {
      raw = await request.text();
    } catch {
      return new Response('Invalid body', { status: 400, headers: this.getCORSHeaders() });
    }
    const bodyBytes = new TextEncoder().encode(raw).length;
    if (bodyBytes > MAX_BYTES) {
      return new Response('Payload too large', { status: 413, headers: this.getCORSHeaders() });
    }

    type BatchItem = { sql: string; params?: unknown[] };
    let body: { batch?: BatchItem[] } = {};
    try {
      body = (raw ? JSON.parse(raw) : {}) as { batch?: BatchItem[] };
    } catch {
      return new Response('Invalid JSON', { status: 400, headers: this.getCORSHeaders() });
    }

    const items = Array.isArray(body.batch) ? body.batch : [];
    if (items.length === 0) {
      return new Response(
        JSON.stringify({ success: true, data: { results: [], totalRowsAffected: 0 } }),
        {
          headers: { 'Content-Type': 'application/json', ...this.getCORSHeaders() },
        }
      );
    }
    if (items.length > MAX_OPS) {
      return new Response('Too many operations in batch', {
        status: 413,
        headers: this.getCORSHeaders(),
      });
    }

    // Optional idempotency key
    const idemKey =
      request.headers.get('Idempotency-Key') || request.headers.get('X-Idempotency-Key');
    if (idemKey) {
      const cacheKey = `idemp:batch:${tenantId}:${idemKey}`;
      try {
        const cached = await this._env.APP_CACHE.get(cacheKey, 'text');
        if (cached) {
          return new Response(cached, {
            headers: { 'Content-Type': 'application/json', ...this.getCORSHeaders() },
          });
        }
      } catch {
        // ignore cache read errors
      }
    }

    // Group operations by target shard
    const groups = new Map<
      string,
      { shardId: string; targetId: DurableObjectId; ops: BatchItem[] }
    >();
    for (const it of items) {
      const { sql } = it;
      const { sql: transpiled, hints } = this.sqlCompatibility.transpileSQL(sql);
      // Validate statement types: only allow INSERT/UPDATE/DELETE
      const st = this.sqlCompatibility.getStatementType(transpiled);
      if (!(st === 'INSERT' || st === 'UPDATE' || st === 'DELETE')) {
        return new Response('Only INSERT/UPDATE/DELETE allowed in batch', {
          status: 400,
          headers: this.getCORSHeaders(),
        });
      }
      const queryReq: QueryRequest = {
        sql: transpiled,
        params: it.params || [],
        ...(hints && { hints }),
      };
      const target = await this.routerService.routeQuery(queryReq, tenantId);
      const shardIds = this.shardSplitService.resolveWriteShards(tenantId, target.shardId);
      for (const shardId of shardIds) {
        const targetId =
          shardId === target.shardId ? target.durableObjectId : this._env.SHARD.idFromName(shardId);
        const key = targetId.toString();
        const arr = groups.get(key);
        const updated = { sql: transpiled, params: it.params || [] };
        if (arr) {
          arr.ops.push(updated);
        } else {
          groups.set(key, { shardId, targetId, ops: [updated] });
        }
      }
    }

    let totalRowsAffected = 0;
    const results: Array<{ rowsAffected: number }> = [];
    const started = Date.now();

    for (const [, group] of groups) {
      const stub = this.getShardStub(group.targetId);
      const res = await this.breaker.execute(group.shardId, () =>
        stub.fetch(
          new Request('http://do/mutation/batch', {
            method: 'POST',
            body: JSON.stringify({ tenantId, operations: group.ops }),
          })
        )
      );
      const payload = (await res.json()) as { success: boolean; rowsAffected: number };
      if (!payload.success) {
        return new Response(JSON.stringify({ success: false, error: 'Batch failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...this.getCORSHeaders() },
        });
      }
      totalRowsAffected += payload.rowsAffected;
      results.push({ rowsAffected: payload.rowsAffected });
    }

    const durationMs = Date.now() - started;
    // Minimal batch metrics log
    try {
      this.log('info', 'batch_exec', {
        tenantId,
        groups: groups.size,
        ops: items.length,
        rowsAffected: totalRowsAffected,
        durationMs,
      });
    } catch (e) {
      this.log('warn', 'batch metrics log failed', { error: (e as Error).message });
    }

    const responseBody = JSON.stringify({ success: true, data: { results, totalRowsAffected } });

    // Store idempotent response
    if (idemKey) {
      const cacheKey = `idemp:batch:${tenantId}:${idemKey}`;
      this._ctx.waitUntil(
        this._env.APP_CACHE.put(cacheKey, responseBody, { expirationTtl: 300 }).catch(() => void 0)
      );
    }

    return new Response(responseBody, {
      headers: { 'Content-Type': 'application/json', ...this.getCORSHeaders() },
    });
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

    // For testing purposes, accept 'test' token or tenant tokens
    if (token === 'test' || token.startsWith('tenant')) {
      return {
        valid: true,
        tenantId: token === 'test' ? 'test' : token,
        permissions: ['admin', 'read', 'write'],
      };
    }

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
    // Determine consistency mode from query hints and table policy
    const policy = await this.configService.getTablePolicy(query.tableName).catch(() => {
      return {
        cache: {
          mode: 'bounded' as const,
          ttlMs: this.configService.getCacheTTL(),
          swrMs: this.configService.getCacheSWR(),
        },
        pk: 'id',
      };
    });
    const hintMode = query.hints?.consistency;
    let mode: 'strong' | 'bounded' | 'cached' = policy.cache.mode;
    if (hintMode) {
      mode = hintMode;
    }

    // Strong mode: bypass cache entirely
    if (mode === 'strong') {
      return await this.executeSelectAndMaybeCache(query, tenantId, false);
    }

    // Bounded mode: return only if fresh within TTL; otherwise hit DO
    const cachedBounded = await this.cacheService.getMaterialized(
      tenantId,
      query.tableName,
      query.sql,
      query.params
    );
    if (cachedBounded && this.cacheService.isFresh(cachedBounded)) {
      return { success: true, data: cachedBounded.data, cached: true, executionTime: 0 };
    }

    if (mode === 'bounded') {
      // Fetch from DO and update cache synchronously
      return await this.executeSelectAndMaybeCache(query, tenantId, true);
    }

    // Cached (SWR) mode: serve stale-while-revalidate
    const cachedSWR = cachedBounded; // reuse fetch if any
    if (cachedSWR && this.cacheService.isStaleButRevalidatable(cachedSWR)) {
      // Serve stale and kick off revalidation
      this._ctx.waitUntil(this.executeSelectAndMaybeCache(query, tenantId, true).then(() => {}));
      return { success: true, data: cachedSWR.data, cached: true, executionTime: 0 };
    }
    if (cachedSWR && this.cacheService.isFresh(cachedSWR)) {
      return { success: true, data: cachedSWR.data, cached: true, executionTime: 0 };
    }
    // No cache available or expired: fetch and cache
    return await this.executeSelectAndMaybeCache(query, tenantId, true);
  }

  // Execute SELECT against DO and optionally write to cache
  private async executeSelectAndMaybeCache(
    query: SQLQuery,
    tenantId: string,
    writeCache: boolean
  ): Promise<WorkerResponse> {
    const startTime = Date.now();
    const queryRequest: QueryRequest = {
      sql: query.sql,
      params: query.params,
      ...(query.hints && { hints: query.hints }),
    };
    const targetInfo = await this.routerService.routeQuery(queryRequest, tenantId);
    const resolvedShardId = this.shardSplitService.resolveReadShard(tenantId, targetInfo.shardId);
    const durableObjectId =
      resolvedShardId === targetInfo.shardId
        ? targetInfo.durableObjectId
        : this._env.SHARD.idFromName(resolvedShardId);
    const shard = this.getShardStub(durableObjectId);

    const result = await this.breaker.execute(resolvedShardId, () =>
      shard.fetch(
        new Request('http://do/query', {
          method: 'POST',
          body: JSON.stringify({ query, tenantId }),
        })
      )
    );

    const data = await result.json<WorkerResponse>();
    const executionTime = Date.now() - startTime;

    if (writeCache) {
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
    }

    return { success: true, data: data.data, cached: false, executionTime };
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
    const writeShardIds = this.shardSplitService.resolveWriteShards(tenantId, targetInfo.shardId);
    let primaryResult: WorkerResponse | null = null;

    for (const shardId of writeShardIds) {
      const stub =
        shardId === targetInfo.shardId
          ? this.getShardStub(targetInfo.durableObjectId)
          : this.getShardStubByName(shardId);

      const response = (await this.breaker.execute(shardId, () =>
        stub.fetch(
          new Request('http://do/mutation', {
            method: 'POST',
            body: JSON.stringify({ query, tenantId }),
          })
        )
      )) as Response;

      if (shardId === writeShardIds[0]) {
        primaryResult = await response.json<WorkerResponse>();
      } else {
        // exhaust response body to avoid leaked streams
        await response.arrayBuffer().catch(() => undefined);
      }
    }

    if (!primaryResult) {
      throw new EdgeSQLError('Primary shard mutation failed', 'MUTATION_FAILED');
    }
    const executionTime = Date.now() - startTime;

    // Invalidate related cache entries and send queue event
    this._ctx.waitUntil(
      Promise.all([
        this.invalidateCache(tenantId, query.tableName),
        ...Array.from(new Set(writeShardIds)).map((shardId) =>
          this._env.DB_EVENTS.send({
            type: 'invalidate',
            shardId,
            version: Date.now(),
            timestamp: Date.now(),
            keys: [`${tenantId}:${query.tableName}`],
          })
        ),
      ])
    );

    return {
      success: true,
      data: primaryResult.data,
      cached: false,
      executionTime,
    };
  }

  /**
   * Handle DDL operations (CREATE, ALTER, DROP, etc.)
   */
  private async handleDDL(query: SQLQuery, tenantId: string): Promise<WorkerResponse> {
    const startTime = Date.now();
    // Route DDL via RouterService so CREATE/ALTER/DROP happen on the same shard as subsequent operations
    const queryRequest: QueryRequest = {
      sql: query.sql,
      params: query.params,
      ...(query.hints && { hints: query.hints }),
    };
    const targetInfo = await this.routerService.routeQuery(queryRequest, tenantId);
    const writeShardIds = this.shardSplitService.resolveWriteShards(tenantId, targetInfo.shardId);
    let primaryResult: WorkerResponse | null = null;

    for (const shardId of writeShardIds) {
      const stub =
        shardId === targetInfo.shardId
          ? this.getShardStub(targetInfo.durableObjectId)
          : this.getShardStubByName(shardId);
      const response = (await this.breaker.execute(shardId, () =>
        stub.fetch(
          new Request('http://do/ddl', {
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
      )) as Response;

      if (shardId === writeShardIds[0]) {
        primaryResult = await response.json<WorkerResponse>();
      } else {
        await response.arrayBuffer().catch(() => undefined);
      }
    }

    if (!primaryResult) {
      throw new EdgeSQLError('Primary shard DDL failed', 'DDL_FAILED');
    }
    const executionTime = Date.now() - startTime;

    // Invalidate all cache for tenant on DDL changes
    this._ctx.waitUntil(this.invalidateAllCache(tenantId));

    return {
      success: true,
      data: primaryResult.data,
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

  private getShardStub(id: DurableObjectId): DurableObjectStub {
    const key = id.toString();
    const cached = this._stubCache.get(key);
    if (cached) {
      return cached;
    }
    const stub = this._env.SHARD.get(id);
    this._stubCache.set(key, stub);
    return stub;
  }

  private getShardStubByName(shardId: string): DurableObjectStub {
    return this.getShardStub(this._env.SHARD.idFromName(shardId));
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
    if (level === 'error') {
      this.logger.error(message, data);
    } else if (level === 'warn') {
      this.logger.warn(message, data);
    } else {
      this.logger.info(message, data);
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

  public async handleShardAdmin(request: Request, url: URL): Promise<Response> {
    if (!this.shardSplitService) {
      return new Response(
        JSON.stringify({ success: false, error: 'Shard split service unavailable' }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json', ...this.getCORSHeaders() },
        }
      );
    }

    const headers = { 'Content-Type': 'application/json', ...this.getCORSHeaders() };
    const auth = this.validateAuth(request);
    if (
      !auth.valid ||
      !auth.permissions?.some((p: unknown) => String(p).toLowerCase().includes('admin'))
    ) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
        status: 403,
        headers,
      });
    }

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length >= 3 && segments[2] === 'metrics') {
      const metrics = this.shardSplitService.getMetrics();
      return new Response(JSON.stringify({ success: true, data: metrics }), { headers });
    }

    if (segments.length === 3 && segments[2] === 'split') {
      if (request.method === 'GET') {
        return new Response(
          JSON.stringify({ success: true, data: this.shardSplitService.listPlans() }),
          {
            headers,
          }
        );
      }
      if (request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as {
          sourceShard?: string;
          targetShard?: string;
          tenantIds?: string[];
        };
        if (!body.sourceShard || !body.targetShard || !Array.isArray(body.tenantIds)) {
          return new Response(JSON.stringify({ success: false, error: 'Invalid payload' }), {
            status: 400,
            headers,
          });
        }
        const plan = await this.shardSplitService.planSplit({
          sourceShard: body.sourceShard,
          targetShard: body.targetShard,
          tenantIds: body.tenantIds,
        });
        return new Response(JSON.stringify({ success: true, data: plan }), {
          status: 201,
          headers,
        });
      }
      return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
        status: 405,
        headers,
      });
    }

    if (segments.length >= 4 && segments[2] === 'split') {
      const splitId = segments[3]!;
      const action = segments[4] ?? '';

      if (request.method === 'GET' && !action) {
        const plan = await this.shardSplitService.getPlan(splitId);
        if (!plan) {
          return new Response(JSON.stringify({ success: false, error: 'Not found' }), {
            status: 404,
            headers,
          });
        }
        return new Response(JSON.stringify({ success: true, data: plan }), { headers });
      }

      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
          status: 405,
          headers,
        });
      }

      switch (action) {
        case 'dual-write': {
          const plan = await this.shardSplitService.startDualWrite({ splitId });
          return new Response(JSON.stringify({ success: true, data: plan }), { headers });
        }
        case 'backfill': {
          const plan = await this.shardSplitService.runBackfill({ splitId, ctx: this._ctx });
          return new Response(JSON.stringify({ success: true, data: plan }), { headers });
        }
        case 'tail': {
          const plan = await this.shardSplitService.replayTail({ splitId });
          return new Response(JSON.stringify({ success: true, data: plan }), { headers });
        }
        case 'cutover': {
          const plan = await this.shardSplitService.cutover({ splitId });
          return new Response(JSON.stringify({ success: true, data: plan }), { headers });
        }
        case 'rollback': {
          const plan = await this.shardSplitService.rollback({ splitId });
          return new Response(JSON.stringify({ success: true, data: plan }), { headers });
        }
        default:
          return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), {
            status: 404,
            headers,
          });
      }
    }

    return new Response(JSON.stringify({ success: false, error: 'Not found' }), {
      status: 404,
      headers,
    });
  }

  /**
   * Admin GraphQL analytics proxy
   * - Injects CF API token from env secret
   * - Applies short TTL caching in KV to avoid rate bursts
   * - Basic RBAC gate: requires Authorization present and valid tenant
   */
  public async handleAdminGraphQL(request: Request): Promise<Response> {
    const auth = this.validateAuth(request);
    if (!auth.valid || !auth.tenantId) {
      return new Response('Unauthorized', { status: 401, headers: this.getCORSHeaders() });
    }

    // Only allow admin tenants/roles. For now require a role claim containing 'admin'.
    const hasAdmin =
      Array.isArray(auth.permissions) &&
      auth.permissions.some((r) => String(r).toLowerCase().includes('admin'));
    if (!hasAdmin) {
      return new Response('Forbidden', { status: 403, headers: this.getCORSHeaders() });
    }

    let body: { query?: string; variables?: Record<string, unknown> } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return new Response('Invalid JSON', { status: 400, headers: this.getCORSHeaders() });
    }
    if (!body.query || typeof body.query !== 'string') {
      return new Response('Missing query', { status: 400, headers: this.getCORSHeaders() });
    }

    // TTL cache key (hash query+vars)
    const keySeed = JSON.stringify({ q: body.query, v: body.variables || {} });
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keySeed));
    const hex = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const cacheKey = `admin:gql:${hex}`;

    // 30s TTL cache to ease rate limits
    try {
      const cached = await this._env.APP_CACHE.get(cacheKey, 'text');
      if (cached) {
        return new Response(cached, {
          headers: { 'Content-Type': 'application/json', ...this.getCORSHeaders() },
        });
      }
    } catch {
      // ignore cache read errors
    }

    const evars = this._env as unknown as Record<string, unknown>;
    const endpoint =
      (evars['CLOUDFLARE_GRAPHQL_ENDPOINT'] as string) ||
      'https://api.cloudflare.com/client/v4/graphql';
    const accountId = (evars['CLOUDFLARE_ACCOUNT_ID'] as string) || '';
    const token = (evars['CLOUDFLARE_API_TOKEN'] as string) || '';
    if (!token) {
      return new Response('Upstream token not configured', {
        status: 500,
        headers: this.getCORSHeaders(),
      });
    }

    // Optionally enrich variables with accountTag if not provided
    const variables = { accountTag: accountId, ...(body.variables || {}) } as Record<
      string,
      unknown
    >;

    const upstreamReq = new Request(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: body.query, variables }),
    });

    const upstreamRes = await fetch(upstreamReq);
    const text = await upstreamRes.text();

    if (upstreamRes.ok) {
      this._ctx.waitUntil(
        this._env.APP_CACHE.put(cacheKey, text, { expirationTtl: 30 }).catch(() => void 0)
      );
    }

    return new Response(text, {
      status: upstreamRes.status,
      headers: { 'Content-Type': 'application/json', ...this.getCORSHeaders() },
    });
  }
}

// Export Durable Object classes for Wrangler
export { TableShard } from './services/TableShard';
