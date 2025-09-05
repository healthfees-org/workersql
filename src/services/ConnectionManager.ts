export interface SessionInfo {
  tenantId: string;
  shardId: string;
  lastSeen: number;
  transactionId?: string;
  isInTransaction: boolean;
  connectionState: 'active' | 'idle' | 'closing';
}

export interface ConnectionPool {
  shardId: string;
  maxConnections: number;
  activeConnections: number;
  idleConnections: WebSocket[];
  waitingQueue: Array<(conn: WebSocket) => void>;
}

type SocketFactory = (url: string) => WebSocket;

export interface ConnectionManagerOptions {
  // Resolve the websocket URL for a given shard
  endpointResolver?: (shardId: string) => string;
  // Factory to construct a WebSocket (useful for environments/tests)
  socketFactory?: SocketFactory;
}

export class ConnectionManager {
  private sessions = new Map<string, SessionInfo>(); // sessionId -> info
  private shardConnectionCounts = new Map<string, number>();
  private connectionPools = new Map<string, ConnectionPool>();
  // In Node (Jest), setInterval returns a Timer object that can be unref()'d
  // to avoid keeping the event loop alive; in browsers it is a number.
  private cleanupInterval?: any;
  private endpointResolver: (shardId: string) => string;
  private socketFactory: SocketFactory;
  private _ttlMs: number;
  private _maxConnectionsPerShard: number;

  constructor(
    ttlMs: number = 10 * 60 * 1000, // 10 minutes default
    maxConnectionsPerShard: number = 10,
    options?: ConnectionManagerOptions
  ) {
    this._ttlMs = ttlMs;
    this._maxConnectionsPerShard = maxConnectionsPerShard;
    this.endpointResolver =
      options?.endpointResolver ?? ((sid) => this.buildShardWebSocketUrl(sid));
    this.socketFactory = options?.socketFactory ?? ((url) => new WebSocket(url));
    this.startCleanupInterval();
  }

  // Enhanced session binding with transaction support
  bindSession(sessionId: string, tenantId: string, shardId: string, transactionId?: string): void {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      // Update existing session
      existing.lastSeen = Date.now();
      if (transactionId) {
        existing.transactionId = transactionId;
      } else {
        delete existing.transactionId;
      }
      existing.isInTransaction = !!transactionId;
      existing.connectionState = 'active';
      return;
    }

    const sessionInfo: SessionInfo = {
      tenantId,
      shardId,
      lastSeen: Date.now(),
      isInTransaction: !!transactionId,
      connectionState: 'active',
    };

    if (transactionId) {
      sessionInfo.transactionId = transactionId;
    }

    this.sessions.set(sessionId, sessionInfo);

    this.shardConnectionCounts.set(shardId, (this.shardConnectionCounts.get(shardId) || 0) + 1);

    // Initialize connection pool for shard if not exists
    if (!this.connectionPools.has(shardId)) {
      this.connectionPools.set(shardId, {
        shardId,
        maxConnections: this._maxConnectionsPerShard,
        activeConnections: 0,
        idleConnections: [],
        waitingQueue: [],
      });
    }
  }

  getSession(sessionId: string): SessionInfo | undefined {
    const info = this.sessions.get(sessionId);
    if (info) {
      info.lastSeen = Date.now();
    }
    return info;
  }

  // Enhanced release with connection pool management
  releaseSession(sessionId: string): void {
    const info = this.sessions.get(sessionId);
    if (!info) {
      return;
    }

    // If in transaction, don't release immediately
    if (info.isInTransaction) {
      info.connectionState = 'idle';
      return;
    }

    this.sessions.delete(sessionId);
    this.shardConnectionCounts.set(
      info.shardId,
      Math.max(0, (this.shardConnectionCounts.get(info.shardId) || 1) - 1)
    );

    // Return connection to pool
    this.returnConnectionToPool(info.shardId);
  }

  // Transaction management
  startTransaction(sessionId: string, transactionId: string): boolean {
    const info = this.sessions.get(sessionId);
    if (!info) {
      return false;
    }

    if (transactionId) {
      info.transactionId = transactionId;
    } else {
      delete info.transactionId;
    }
    info.isInTransaction = true;
    info.connectionState = 'active';
    info.lastSeen = Date.now();
    return true;
  }

  endTransaction(sessionId: string): boolean {
    const info = this.sessions.get(sessionId);
    if (!info || !info.isInTransaction) {
      return false;
    }

    delete info.transactionId;
    info.isInTransaction = false;
    info.connectionState = 'idle';
    info.lastSeen = Date.now();
    return true;
  }

  getShardConnections(shardId: string): number {
    return this.shardConnectionCounts.get(shardId) || 0;
  }

  // Connection pooling methods
  async acquireConnection(shardId: string): Promise<WebSocket | null> {
    const pool = this.connectionPools.get(shardId);
    if (!pool) {
      return null;
    }

    // Try to get idle connection
    if (pool.idleConnections.length > 0) {
      const conn = pool.idleConnections.pop()!;
      pool.activeConnections++;
      return conn;
    }

    // Check if we can create new connection
    if (pool.activeConnections < pool.maxConnections) {
      pool.activeConnections++;
      return this.createNewConnection(shardId);
    }

    // Wait for available connection
    return new Promise((resolve) => {
      pool.waitingQueue.push(resolve);
    });
  }

  releaseConnection(shardId: string, connection: WebSocket): void {
    const pool = this.connectionPools.get(shardId);
    if (!pool) {
      return;
    }

    pool.activeConnections = Math.max(0, pool.activeConnections - 1);

    // Check if connection is still valid
    if (this.isConnectionValid(connection)) {
      pool.idleConnections.push(connection);

      // Notify waiting requests
      if (pool.waitingQueue.length > 0) {
        const resolver = pool.waitingQueue.shift()!;
        const conn = pool.idleConnections.pop()!;
        pool.activeConnections++;
        resolver(conn);
      }
    } else {
      // Connection is invalid, don't return to pool
      this.returnConnectionToPool(shardId);
    }
  }

  private returnConnectionToPool(shardId: string): void {
    const pool = this.connectionPools.get(shardId);
    if (!pool) {
      return;
    }

    // Notify waiting requests if we have idle connections
    if (pool.idleConnections.length > 0 && pool.waitingQueue.length > 0) {
      const resolver = pool.waitingQueue.shift()!;
      const conn = pool.idleConnections.pop()!;
      pool.activeConnections++;
      resolver(conn);
    }
  }

  private createNewConnection(shardId: string): WebSocket {
    // Establish a WebSocket connection to the shard endpoint
    const url = this.endpointResolver(shardId);
    const ws = this.socketFactory(url);

    ws.addEventListener('close', () => {
      this.handleConnectionClose(shardId, ws);
    });
    ws.addEventListener('error', () => {
      this.handleConnectionError(shardId, ws);
    });
    return ws;
  }

  private buildShardWebSocketUrl(shardId: string): string {
    // Default production endpoint pattern; override via endpointResolver if needed
    // Example: wss://shard-<id>.workersql.dev
    return `wss://shard-${shardId}.workersql.dev`;
  }

  private isConnectionValid(connection: WebSocket): boolean {
    return connection.readyState === WebSocket.OPEN;
  }

  private handleConnectionClose(shardId: string, connection: WebSocket): void {
    const pool = this.connectionPools.get(shardId);
    if (!pool) {
      return;
    }

    // Remove from idle connections if present
    const idleIndex = pool.idleConnections.indexOf(connection);
    if (idleIndex > -1) {
      pool.idleConnections.splice(idleIndex, 1);
    } else {
      // Was active, decrement active count
      pool.activeConnections = Math.max(0, pool.activeConnections - 1);
    }

    // Notify waiting requests
    this.returnConnectionToPool(shardId);
  }

  private handleConnectionError(shardId: string, connection: WebSocket): void {
    // Same as close for error handling
    this.handleConnectionClose(shardId, connection);
  }

  // Enhanced cleanup with connection pool management
  cleanup(): void {
    const cutoff = Date.now() - this._ttlMs;

    // Clean up stale sessions
    for (const [id, info] of this.sessions.entries()) {
      if (info.lastSeen < cutoff && !info.isInTransaction) {
        this.releaseSession(id);
      }
    }

    // Clean up stale connections in pools
    for (const [, pool] of this.connectionPools.entries()) {
      // Remove stale idle connections
      pool.idleConnections = pool.idleConnections.filter((conn) => {
        if (conn.readyState !== WebSocket.OPEN) {
          pool.activeConnections = Math.max(0, pool.activeConnections - 1);
          return false;
        }
        return true;
      });

      // Close connections that have been idle too long
      const staleConnections = pool.idleConnections.splice(0);
      for (const conn of staleConnections) {
        try {
          conn.close();
        } catch (_e) {
          // Ignore close errors
        }
      }
    }
  }

  private startCleanupInterval(): void {
    // Run cleanup every minute
    const timer: any = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);
    // Prevent Jest/Node process from staying alive because of this interval
    if (typeof timer?.unref === 'function') {
      timer.unref();
    }
    this.cleanupInterval = timer;
  }

  // Get connection pool stats
  getPoolStats(shardId: string): {
    active: number;
    idle: number;
    waiting: number;
    max: number;
  } | null {
    const pool = this.connectionPools.get(shardId);
    if (!pool) {
      return null;
    }

    return {
      active: pool.activeConnections,
      idle: pool.idleConnections.length,
      waiting: pool.waitingQueue.length,
      max: pool.maxConnections,
    };
  }

  // Force close all connections for a shard
  async closeShardConnections(shardId: string): Promise<void> {
    const pool = this.connectionPools.get(shardId);
    if (!pool) {
      return;
    }

    // Close all idle connections
    for (const conn of pool.idleConnections) {
      try {
        conn.close();
      } catch (_e) {
        // Ignore close errors
      }
    }
    pool.idleConnections = [];

    // Note: Active connections will be closed when released
    pool.activeConnections = 0;
    pool.waitingQueue = [];
  }

  // Get all active sessions for monitoring
  getActiveSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).filter((info) => info.connectionState === 'active');
  }

  // Get sessions in transaction
  getTransactionSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).filter((info) => info.isInTransaction);
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Close all connections
    for (const pool of this.connectionPools.values()) {
      for (const conn of pool.idleConnections) {
        try {
          conn.close();
        } catch (_e) {
          // Ignore close errors
        }
      }
    }

    this.sessions.clear();
    this.shardConnectionCounts.clear();
    this.connectionPools.clear();
  }
}
