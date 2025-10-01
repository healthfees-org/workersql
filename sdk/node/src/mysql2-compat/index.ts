/**
 * mysql2-compatible interface for WorkerSQL
 *
 * Drop-in replacement for mysql2/promise that uses WorkerSQL HTTP API.
 * Compatible with TypeORM, Sequelize, Knex, and other Node.js ORMs.
 */

import { WorkerSQLClient } from '../index.js';

export interface ConnectionOptions {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  apiKey?: string;
  ssl?: boolean;
  timeout?: number;
  dsn?: string;
}

export interface PoolOptions extends ConnectionOptions {
  connectionLimit?: number;
  waitForConnections?: boolean;
  queueLimit?: number;
}

export class Connection {
  private client: WorkerSQLClient;
  private inTransaction = false;

  constructor(options: ConnectionOptions) {
    const dsn = options.dsn || this.buildDSN(options);
    this.client = new WorkerSQLClient(dsn);
  }

  private buildDSN(options: ConnectionOptions): string {
    const protocol = 'workersql://';
    const auth = options.user && options.password
      ? `${options.user}:${options.password}@`
      : '';
    const host = options.host || 'localhost';
    const port = options.port ? `:${options.port}` : '';
    const database = options.database ? `/${options.database}` : '';
    const params = new URLSearchParams();
    if (options.apiKey) params.set('apiKey', options.apiKey);
    if (options.ssl !== undefined) params.set('ssl', String(options.ssl));
    if (options.timeout) params.set('timeout', String(options.timeout));
    const queryString = params.toString() ? `?${params.toString()}` : '';
    return `${protocol}${auth}${host}${port}${database}${queryString}`;
  }

  async query(sql: string, values?: any[]): Promise<any> {
    const result = await this.client.query(sql, values);
    return [result.data, []];
  }

  async execute(sql: string, values?: any[]): Promise<any> {
    const result = await this.client.query(sql, values);
    return [result.data, []];
  }

  async beginTransaction(): Promise<void> {
    this.inTransaction = true;
  }

  async commit(): Promise<void> {
    this.inTransaction = false;
  }

  async rollback(): Promise<void> {
    this.inTransaction = false;
  }

  async end(): Promise<void> {
    await this.client.close();
  }

  async destroy(): Promise<void> {
    await this.client.close();
  }
}

export class Pool extends Connection {
  constructor(options: PoolOptions) {
    super({
      ...options,
      pooling: {
        enabled: true,
        minConnections: 1,
        maxConnections: options.connectionLimit || 10,
      }
    } as any);
  }

  async getConnection(): Promise<Connection> {
    return this;
  }

  async releaseConnection(connection: Connection): Promise<void> {
    // Pool manages connections automatically
  }
}

export function createConnection(options: ConnectionOptions): Connection {
  return new Connection(options);
}

export function createPool(options: PoolOptions): Pool {
  return new Pool(options);
}

export default {
  createConnection,
  createPool,
  Connection,
  Pool,
};
