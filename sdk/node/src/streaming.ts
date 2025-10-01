/**
 * Result streaming support for WorkerSQL Node.js SDK
 * Enables processing large result sets without loading all data into memory
 */

import { Readable } from 'stream';
import { EventEmitter } from 'events';

export interface StreamOptions {
  highWaterMark?: number;
  batchSize?: number;
  timeout?: number;
}

export interface StreamRow {
  [key: string]: any;
}

/**
 * Streaming query result reader
 */
export class QueryStream extends Readable {
  private offset: number = 0;
  private ended: boolean = false;

  constructor(
    private sql: string,
    private params: any[] = [],
    private queryFn: (sql: string, params?: any[]) => Promise<any>,
    private options: StreamOptions = {}
  ) {
    super({ objectMode: true, highWaterMark: options.highWaterMark || 16 });
    this.options.batchSize = options.batchSize || 100;
  }

  async _read(): Promise<void> {
    if (this.ended) {
      this.push(null);
      return;
    }

    try {
      // Modify SQL to add LIMIT and OFFSET
      const streamSql = this.addPagination(this.sql, this.options.batchSize!, this.offset);

      const result = await this.queryFn(streamSql, this.params);
      const rows = result.data || [];

      if (rows.length === 0) {
        this.ended = true;
        this.push(null);
        return;
      }

      for (const row of rows) {
        if (!this.push(row)) {
          // Backpressure - stop reading
          return;
        }
      }

      this.offset += rows.length;

      // If we got fewer rows than batchSize, we've reached the end
      if (rows.length < this.options.batchSize!) {
        this.ended = true;
        this.push(null);
      }
    } catch (error) {
      this.destroy(error as Error);
    }
  }

  private addPagination(sql: string, limit: number, offset: number): string {
    // Simple pagination - in production, would need more sophisticated SQL parsing
    const trimmedSql = sql.trim();

    // Remove existing LIMIT clause if present
    const limitPattern = /\s+LIMIT\s+\d+(\s+OFFSET\s+\d+)?$/i;
    const baseSql = trimmedSql.replace(limitPattern, '');

    return `${baseSql} LIMIT ${limit} OFFSET ${offset}`;
  }
}

/**
 * Cursor-based streaming for large result sets
 */
export class CursorStream extends EventEmitter {
  private cursorId: string | null = null;
  private closed: boolean = false;

  constructor(
    private sql: string,
    private params: any[] = [],
    private queryFn: (sql: string, params?: any[]) => Promise<any>,
    private options: StreamOptions = {}
  ) {
    super();
    this.options.batchSize = options.batchSize || 100;
  }

  /**
   * Open cursor and start streaming
   */
  async start(): Promise<void> {
    try {
      // Initialize cursor (implementation depends on server support)
      const result = await this.queryFn(
        `DECLARE cursor_${Date.now()} CURSOR FOR ${this.sql}`,
        this.params
      );

      this.cursorId = result.cursorId || `cursor_${Date.now()}`;
      this.emit('open', this.cursorId);

      await this.fetchNext();
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Fetch next batch of rows
   */
  private async fetchNext(): Promise<void> {
    if (this.closed || !this.cursorId) {
      return;
    }

    try {
      const result = await this.queryFn(
        `FETCH ${this.options.batchSize} FROM ${this.cursorId}`,
        []
      );

      const rows = result.data || [];

      if (rows.length === 0) {
        await this.close();
        this.emit('end');
        return;
      }

      for (const row of rows) {
        this.emit('data', row);
      }

      // Continue fetching
      setImmediate(() => this.fetchNext());
    } catch (error) {
      this.emit('error', error);
      await this.close();
    }
  }

  /**
   * Close cursor and release resources
   */
  async close(): Promise<void> {
    if (this.closed || !this.cursorId) {
      return;
    }

    try {
      await this.queryFn(`CLOSE ${this.cursorId}`, []);
      this.closed = true;
      this.emit('close');
    } catch (error) {
      this.emit('error', error);
    }
  }
}

/**
 * Async iterator for query results
 */
export class QueryIterator implements AsyncIterableIterator<StreamRow> {
  private offset: number = 0;
  private currentBatch: StreamRow[] = [];
  private batchIndex: number = 0;
  private done: boolean = false;

  constructor(
    private sql: string,
    private params: any[] = [],
    private queryFn: (sql: string, params?: any[]) => Promise<any>,
    private batchSize: number = 100
  ) {}

  async next(): Promise<IteratorResult<StreamRow>> {
    // If we have rows in current batch, return next one
    if (this.batchIndex < this.currentBatch.length) {
      return {
        done: false,
        value: this.currentBatch[this.batchIndex++]
      };
    }

    // If we're done, return
    if (this.done) {
      return { done: true, value: undefined };
    }

    // Fetch next batch
    try {
      const streamSql = this.addPagination(this.sql, this.batchSize, this.offset);
      const result = await this.queryFn(streamSql, this.params);
      this.currentBatch = result.data || [];
      this.batchIndex = 0;
      this.offset += this.currentBatch.length;

      if (this.currentBatch.length === 0) {
        this.done = true;
        return { done: true, value: undefined };
      }

      if (this.currentBatch.length < this.batchSize) {
        this.done = true;
      }

      return {
        done: false,
        value: this.currentBatch[this.batchIndex++]
      };
    } catch (error) {
      this.done = true;
      throw error;
    }
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<StreamRow> {
    return this;
  }

  private addPagination(sql: string, limit: number, offset: number): string {
    const trimmedSql = sql.trim();
    const limitPattern = /\s+LIMIT\s+\d+(\s+OFFSET\s+\d+)?$/i;
    const baseSql = trimmedSql.replace(limitPattern, '');
    return `${baseSql} LIMIT ${limit} OFFSET ${offset}`;
  }
}

/**
 * Helper functions for creating streaming queries
 */
export function createQueryStream(
  sql: string,
  params: any[],
  queryFn: (sql: string, params?: any[]) => Promise<any>,
  options?: StreamOptions
): QueryStream {
  return new QueryStream(sql, params, queryFn, options);
}

export function createQueryIterator(
  sql: string,
  params: any[],
  queryFn: (sql: string, params?: any[]) => Promise<any>,
  batchSize?: number
): QueryIterator {
  return new QueryIterator(sql, params, queryFn, batchSize);
}
