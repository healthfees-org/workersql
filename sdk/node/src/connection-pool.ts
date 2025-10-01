/**
 * Connection Pool for WorkerSQL
 * Manages a pool of reusable HTTP connections with health checking
 */

import axios, { AxiosInstance } from 'axios';
import { ValidationError } from '../../schema/validator.js';

export interface PooledConnection {
  id: string;
  instance: AxiosInstance;
  inUse: boolean;
  createdAt: Date;
  lastUsed: Date;
  useCount: number;
}

export interface ConnectionPoolOptions {
  apiEndpoint: string;
  apiKey: string | undefined;
  minConnections?: number;
  maxConnections?: number;
  idleTimeout?: number;
  connectionTimeout?: number;
  healthCheckInterval?: number;
}

export class ConnectionPool {
  private connections: Map<string, PooledConnection> = new Map();
  private options: Required<ConnectionPoolOptions>;
  private healthCheckTimer?: NodeJS.Timeout;
  private closed = false;

  constructor(options: ConnectionPoolOptions) {
    this.options = {
      apiEndpoint: options.apiEndpoint,
      apiKey: options.apiKey,
      minConnections: options.minConnections ?? 1,
      maxConnections: options.maxConnections ?? 10,
      idleTimeout: options.idleTimeout ?? 300000, // 5 minutes
      connectionTimeout: options.connectionTimeout ?? 30000,
      healthCheckInterval: options.healthCheckInterval ?? 60000, // 1 minute
    };

    this.initialize();
  }

  private initialize(): void {
    // Create minimum connections
    for (let i = 0; i < this.options.minConnections; i++) {
      this.createConnection();
    }

    // Start health check timer
    if (this.options.healthCheckInterval > 0) {
      this.healthCheckTimer = setInterval(() => {
        this.performHealthCheck();
      }, this.options.healthCheckInterval);
    }
  }

  private createConnection(): PooledConnection {
    const id = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    
    const instance = axios.create({
      baseURL: this.options.apiEndpoint,
      timeout: this.options.connectionTimeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'WorkerSQL-NodeSDK/1.0.0',
        ...(this.options.apiKey && { 'Authorization': `Bearer ${this.options.apiKey}` }),
      },
    });

    const connection: PooledConnection = {
      id,
      instance,
      inUse: false,
      createdAt: new Date(),
      lastUsed: new Date(),
      useCount: 0,
    };

    this.connections.set(id, connection);
    return connection;
  }

  /**
   * Acquire a connection from the pool
   */
  async acquire(): Promise<PooledConnection> {
    if (this.closed) {
      throw new ValidationError('CONNECTION_ERROR', 'Connection pool is closed');
    }

    // Try to find an idle connection
    for (const conn of this.connections.values()) {
      if (!conn.inUse) {
        conn.inUse = true;
        conn.lastUsed = new Date();
        conn.useCount++;
        return conn;
      }
    }

    // No idle connections, create a new one if below max
    if (this.connections.size < this.options.maxConnections) {
      const conn = this.createConnection();
      conn.inUse = true;
      conn.lastUsed = new Date();
      conn.useCount++;
      return conn;
    }

    // Wait for a connection to become available
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new ValidationError('TIMEOUT_ERROR', 'Timeout waiting for connection'));
      }, this.options.connectionTimeout);

      const checkInterval = setInterval(() => {
        for (const conn of this.connections.values()) {
          if (!conn.inUse) {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            conn.inUse = true;
            conn.lastUsed = new Date();
            conn.useCount++;
            resolve(conn);
            return;
          }
        }
      }, 100);
    });
  }

  /**
   * Release a connection back to the pool
   */
  release(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (conn) {
      conn.inUse = false;
      conn.lastUsed = new Date();
    }
  }

  /**
   * Remove idle connections
   */
  private performHealthCheck(): void {
    const now = Date.now();
    const connectionsToRemove: string[] = [];

    for (const [id, conn] of this.connections.entries()) {
      // Remove idle connections that have exceeded the idle timeout
      if (!conn.inUse && now - conn.lastUsed.getTime() > this.options.idleTimeout) {
        // Keep minimum connections
        if (this.connections.size > this.options.minConnections) {
          connectionsToRemove.push(id);
        }
      }
    }

    for (const id of connectionsToRemove) {
      this.connections.delete(id);
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    total: number;
    active: number;
    idle: number;
    minConnections: number;
    maxConnections: number;
  } {
    const active = Array.from(this.connections.values()).filter(c => c.inUse).length;
    return {
      total: this.connections.size,
      active,
      idle: this.connections.size - active,
      minConnections: this.options.minConnections,
      maxConnections: this.options.maxConnections,
    };
  }

  /**
   * Close the pool and all connections
   */
  async close(): Promise<void> {
    this.closed = true;

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    // Wait for active connections to be released
    const maxWait = 5000; // 5 seconds
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      const activeCount = Array.from(this.connections.values()).filter(c => c.inUse).length;
      if (activeCount === 0) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.connections.clear();
  }
}
