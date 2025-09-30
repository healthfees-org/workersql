import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TableShard } from '../../src/services/TableShard';
import type { CloudflareEnvironment } from '../../src/types';

// Minimal mock cursor implementing toArray() and one()
class MockCursor<T extends Record<string, any> = any> {
  private rows: T[];
  constructor(rows: T[] = []) {
    this.rows = rows;
  }
  [Symbol.iterator](): Iterator<T> {
    let idx = 0;
    const rows = this.rows;
    return {
      next(): IteratorResult<T> {
        if (idx < rows.length) {
          return { done: false, value: rows[idx++] as T };
        }
        return { done: true, value: undefined as unknown as T } as IteratorReturnResult<any>;
      },
    };
  }
  toArray(): T[] {
    return [...this.rows];
  }
  one(): T | undefined {
    return this.rows[0];
  }
}

function createMockState() {
  // tracking counters for retry simulation
  const counters: Record<string, number> = {};

  const storage: any = {
    sql: {
      exec: vi.fn((query: string, ...bindings: any[]) => {
        const q = query.trim();
        // capacity PRAGMAs
        if (/PRAGMA\s+page_count/i.test(q)) {
          return new MockCursor([{ page_count: 1024 }]);
        }
        if (/PRAGMA\s+page_size/i.test(q)) {
          return new MockCursor([{ page_size: 4096 }]);
        }
        if (/SELECT\s+changes\(\)/i.test(q)) {
          return new MockCursor([{ n: 1 }]);
        }
        if (/SELECT\s+last_insert_rowid\(\)/i.test(q)) {
          return new MockCursor([{ id: 99 }]);
        }
        if (/sqlite_schema/i.test(q) && /count\(\*\)/i.test(q)) {
          return new MockCursor([{ n: 3 }]);
        }
        // retry simulation for a specific marker
        if (/UPDATE\s+retry/i.test(q)) {
          counters['retry'] = (counters['retry'] || 0) + 1;
          if (counters['retry'] === 1) {
            throw new Error('D1 DB is overloaded. Requests queued for too long.');
          }
          return new MockCursor();
        }
        // SELECT path
        if (/SELECT/i.test(q) && /FROM\s+users/i.test(q)) {
          // verify that bindings are passed through
          const id = bindings[0] ?? 1;
          return new MockCursor([{ id, name: 'Ada' }]);
        }
        // default empty cursor for CREATE/INSERT/UPDATE/DELETE/etc.
        return new MockCursor();
      }),
    },
    kv: {
      put: vi.fn(),
    },
    getBookmarkForTime: vi.fn(async (_ts: number) => 'bm:for-time'),
    getCurrentBookmark: vi.fn(async () => 'bm:now'),
    onNextSessionRestoreBookmark: vi.fn(async (_b: string) => {}),
    transactionSync: (cb: () => unknown) => cb(),
  };

  return { storage } as unknown as DurableObjectState;
}

function createEnv(): CloudflareEnvironment {
  return {
    APP_CACHE: {} as KVNamespace,
    DB_EVENTS: { send: vi.fn(async () => {}) } as any,
    SHARD: {} as any,
    PORTABLE_DB: {} as any,
    ENVIRONMENT: 'test',
    LOG_LEVEL: 'debug',
    MAX_SHARD_SIZE_GB: '10',
    CACHE_TTL_MS: '1000',
    CACHE_SWR_MS: '2000',
  };
}

describe('TableShard (SQLite-backed)', () => {
  let shard: TableShard;

  beforeEach(async () => {
    const state = createMockState();
    const env = createEnv();
    shard = new (TableShard as any)(state, env);
    // force initialize via calling health (ensures schema creation and capacity refresh attempt)
    await shard.fetch(new Request('https://internal/health'));
  });

  it('executes SELECT with parameter bindings', async () => {
    const res = await shard.fetch(
      new Request('https://internal/query', {
        method: 'POST',
        body: JSON.stringify({
          query: { sql: 'SELECT * FROM users WHERE id=?', params: [42] },
          tenantId: 'acme',
        }),
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.rows[0].id).toBe(42);
  });

  it('executes INSERT mutation and emits invalidation', async () => {
    const env = (shard as any).env as CloudflareEnvironment;
    const res = await shard.fetch(
      new Request('https://internal/mutation', {
        method: 'POST',
        body: JSON.stringify({
          query: { sql: 'INSERT INTO users(name) VALUES(?)', params: ['Ada'] },
          tenantId: 'acme',
        }),
      })
    );
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.rowsAffected).toBeDefined();
    expect(body.insertId).toBe(99);
    expect((env.DB_EVENTS as any).send).toHaveBeenCalled();
  });

  it('queues operations inside a transaction and commits atomically', async () => {
    // BEGIN
    const beginRes = await shard.fetch(
      new Request('https://internal/transaction', {
        method: 'POST',
        body: JSON.stringify({ operation: 'BEGIN', tenantId: 'acme' }),
      })
    );
    const beginBody = (await beginRes.json()) as any;
    const txnId = beginBody.rows[0].transactionId as string;
    expect(txnId).toBeDefined();

    // queue two mutations
    await shard.fetch(
      new Request('https://internal/mutation', {
        method: 'POST',
        body: JSON.stringify({
          query: { sql: 'UPDATE users SET name=? WHERE id=?', params: ['Ada', 1] },
          tenantId: 'acme',
          transactionId: txnId,
        }),
      })
    );
    await shard.fetch(
      new Request('https://internal/mutation', {
        method: 'POST',
        body: JSON.stringify({
          query: { sql: 'DELETE FROM users WHERE id=?', params: [1] },
          tenantId: 'acme',
          transactionId: txnId,
        }),
      })
    );

    // COMMIT
    const commitRes = await shard.fetch(
      new Request('https://internal/transaction', {
        method: 'POST',
        body: JSON.stringify({ operation: 'COMMIT', tenantId: 'acme', transactionId: txnId }),
      })
    );
    const commitBody = (await commitRes.json()) as any;
    expect(commitBody.rowsAffected).toBeGreaterThan(0);
  });

  it('supports PITR bookmark and restore endpoints', async () => {
    const bmRes = await shard.fetch(
      new Request('https://internal/pitr/bookmark', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    );
    const bmBody = (await bmRes.json()) as any;
    expect(bmBody.bookmark).toBe('bm:now');

    const restoreRes = await shard.fetch(
      new Request('https://internal/pitr/restore', {
        method: 'POST',
        body: JSON.stringify({ bookmark: 'bm:for-time' }),
      })
    );
    const restoreBody = (await restoreRes.json()) as any;
    expect(restoreBody.success).toBe(true);
  });

  it('enforces capacity checks', async () => {
    // Override PRAGMA responses to simulate large size: page_count*page_size ~ 12GB
    const state: any = (shard as any).state;
    (state.storage.sql.exec as any).mockImplementation((query: string) => {
      if (/PRAGMA\s+page_count/i.test(query)) {
        return new MockCursor([{ page_count: 3_500_000 }]);
      }
      if (/PRAGMA\s+page_size/i.test(query)) {
        return new MockCursor([{ page_size: 4096 }]);
      }
      return new MockCursor();
    });

    const res = await shard.fetch(
      new Request('https://internal/mutation', {
        method: 'POST',
        body: JSON.stringify({
          query: { sql: 'INSERT INTO users(name) VALUES(?)', params: ['Big'] },
          tenantId: 'acme',
        }),
      })
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(String(body.error)).toContain('SHARD_CAPACITY_EXCEEDED');
  });

  it('retries on transient database busy errors', async () => {
    const res = await shard.fetch(
      new Request('https://internal/mutation', {
        method: 'POST',
        body: JSON.stringify({
          query: { sql: 'UPDATE retry SET a=1', params: [] },
          tenantId: 'acme',
        }),
      })
    );
    expect(res.status).toBe(200);
  });
});
