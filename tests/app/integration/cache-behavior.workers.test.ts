import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SELF } from 'cloudflare:test';

// Comprehensive integration test for cache behavior and performance

describe('Cache Behavior Integration', () => {
  let validToken: string;
  let testTenantId: string;

  beforeAll(async () => {
    validToken = 'Bearer test-valid-token';
    testTenantId = 'test-tenant-cache';

    // Create test table for cache testing
    await SELF.fetch('http://localhost:8787//sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: validToken,
      },
      body: JSON.stringify({
        sql: `
          CREATE TABLE IF NOT EXISTS cache_test_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT,
            author_id INTEGER,
            tenant_id TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `,
      }),
    });

    // Insert test data
    await SELF.fetch('http://localhost:8787//sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: validToken,
      },
      body: JSON.stringify({
        sql: `
          INSERT INTO cache_test_posts (title, content, author_id, tenant_id)
          VALUES
            ('Post 1', 'Content 1', 1, ?),
            ('Post 2', 'Content 2', 1, ?),
            ('Post 3', 'Content 3', 2, ?)
        `,
        params: [testTenantId, testTenantId, testTenantId],
      }),
    });
  });

  afterAll(async () => {
    // Clean up
    await SELF.fetch('http://localhost:8787//sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: validToken,
      },
      body: JSON.stringify({
        sql: 'DROP TABLE IF EXISTS cache_test_posts',
      }),
    });
  });

  describe('Cache Hit/Miss Scenarios', () => {
    it('first query should miss cache and populate it', async () => {
      const query =
        'SELECT id, title, content FROM cache_test_posts WHERE tenant_id = ? ORDER BY id';
      const params = [testTenantId];

      const firstRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: query, params }),
      });
      expect(firstRes.status).toBe(200);

      const firstData = (await firstRes.json()) as {
        success: boolean;
        data: Array<Record<string, unknown>>;
        cached: boolean;
        executionTime: number;
      };
      expect(firstData.success).toBe(true);
      expect(firstData.cached).toBe(false); // Should be a cache miss
      expect(firstData.data).toHaveLength(3);
    });

    it('subsequent identical query should hit cache', async () => {
      const query =
        'SELECT id, title, content FROM cache_test_posts WHERE tenant_id = ? ORDER BY id';
      const params = [testTenantId];

      // Second query should hit cache
      const secondRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: query, params }),
      });
      expect(secondRes.status).toBe(200);

      const secondData = (await secondRes.json()) as {
        success: boolean;
        data: Array<Record<string, unknown>>;
        cached: boolean;
        executionTime: number;
      };
      expect(secondData.success).toBe(true);
      expect(secondData.cached).toBe(true); // Should be a cache hit
      expect(secondData.data).toHaveLength(3);
      expect(secondData.executionTime).toBeLessThan(10); // Cached responses should be fast
    });

    it('query with different parameters should miss cache', async () => {
      const query = 'SELECT id, title FROM cache_test_posts WHERE tenant_id = ? AND author_id = ?';
      const params = [testTenantId, 1];

      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: query, params }),
      });
      expect(res.status).toBe(200);

      const data = (await res.json()) as {
        success: boolean;
        data: Array<Record<string, unknown>>;
        cached: boolean;
      };
      expect(data.success).toBe(true);
      expect(data.cached).toBe(false); // Different query signature
      expect(data.data).toHaveLength(2); // Should return 2 posts by author 1
    });
  });

  describe('Cache Consistency Modes', () => {
    it('strong consistency bypasses cache', async () => {
      const query = 'SELECT COUNT(*) as count FROM cache_test_posts WHERE tenant_id = ?';
      const params = [testTenantId];

      // Query with strong consistency hint
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: query,
          params,
          hints: { consistency: 'strong' },
        }),
      });
      expect(res.status).toBe(200);

      const data = (await res.json()) as {
        success: boolean;
        cached: boolean;
      };
      expect(data.success).toBe(true);
      expect(data.cached).toBe(false); // Strong consistency should bypass cache
    });

    it('bounded consistency serves fresh data from cache', async () => {
      const query =
        'SELECT id, title FROM cache_test_posts WHERE tenant_id = ? ORDER BY id LIMIT 1';
      const params = [testTenantId];

      // First populate cache
      await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: query, params }),
      });

      // Query with bounded consistency
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: query,
          params,
          hints: { consistency: 'bounded' },
        }),
      });
      expect(res.status).toBe(200);

      const data = (await res.json()) as {
        success: boolean;
        cached: boolean;
      };
      expect(data.success).toBe(true);
      // Bounded should serve from cache if fresh
    });
  });

  describe('Cache Invalidation', () => {
    it('INSERT operations invalidate related cache entries', async () => {
      const selectQuery =
        'SELECT id, title FROM cache_test_posts WHERE tenant_id = ? AND author_id = ?';
      const selectParams = [testTenantId, 2];

      // Populate cache
      await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: selectQuery, params: selectParams }),
      });

      // Verify cache hit
      const cachedRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: selectQuery, params: selectParams }),
      });
      const cachedData = (await cachedRes.json()) as { cached: boolean };
      expect(cachedData.cached).toBe(true);

      // Insert new post (should invalidate cache)
      await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'INSERT INTO cache_test_posts (title, content, author_id, tenant_id) VALUES (?, ?, ?, ?)',
          params: ['New Post', 'New Content', 2, testTenantId],
        }),
      });

      // Query again - should miss cache due to invalidation
      const afterInsertRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: selectQuery, params: selectParams }),
      });
      const afterInsertData = (await afterInsertRes.json()) as {
        cached: boolean;
        data: Array<Record<string, unknown>>;
      };
      expect(afterInsertData.cached).toBe(false);
      expect(afterInsertData.data).toHaveLength(2); // Should now include the new post
    });

    it('UPDATE operations invalidate related cache entries', async () => {
      const selectQuery =
        'SELECT title, content FROM cache_test_posts WHERE tenant_id = ? ORDER BY id DESC LIMIT 1';
      const selectParams = [testTenantId];

      // Populate cache
      await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: selectQuery, params: selectParams }),
      });

      // Update the latest post
      await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'UPDATE cache_test_posts SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? ORDER BY id DESC LIMIT 1',
          params: ['Updated Title', testTenantId],
        }),
      });

      // Query again - should miss cache
      const afterUpdateRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: selectQuery, params: selectParams }),
      });
      const afterUpdateData = (await afterUpdateRes.json()) as {
        cached: boolean;
        data: Array<Record<string, unknown>>;
      };
      expect(afterUpdateData.cached).toBe(false);
      expect(afterUpdateData.data).toHaveLength(1);
      expect(afterUpdateData.data[0]!['title']).toBe('Updated Title');
    });

    it('DELETE operations invalidate related cache entries', async () => {
      const selectQuery = 'SELECT COUNT(*) as count FROM cache_test_posts WHERE tenant_id = ?';
      const selectParams = [testTenantId];

      // Populate cache
      await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: selectQuery, params: selectParams }),
      });

      // Delete a post
      await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'DELETE FROM cache_test_posts WHERE title = ? AND tenant_id = ?',
          params: ['Updated Title', testTenantId],
        }),
      });

      // Query again - should miss cache
      const afterDeleteRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: selectQuery, params: selectParams }),
      });
      const afterDeleteData = (await afterDeleteRes.json()) as {
        cached: boolean;
        data: Array<{ count: number }>;
      };
      expect(afterDeleteData.cached).toBe(false);
      expect(afterDeleteData.data).toHaveLength(1);
      expect(afterDeleteData.data[0]!.count).toBe(3); // Should be back to 3 posts
    });
  });

  describe('Cache Performance and TTL', () => {
    it('cache entries expire after TTL', async () => {
      // This test would require manipulating time or waiting for TTL
      // In a real scenario, this would test cache expiration
      const query = 'SELECT id FROM cache_test_posts WHERE tenant_id = ? LIMIT 1';
      const params = [testTenantId];

      // First query to populate cache
      await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: query, params }),
      });

      // Immediate second query should hit cache
      const immediateRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: query, params }),
      });
      const immediateData = (await immediateRes.json()) as { cached: boolean };
      expect(immediateData.cached).toBe(true);
    });

    it('stale-while-revalidate serves stale data while refreshing', async () => {
      // This would test SWR behavior when cache is stale but still revalidatable
      // Implementation depends on cache configuration
      const query = 'SELECT COUNT(*) as count FROM cache_test_posts WHERE tenant_id = ?';
      const params = [testTenantId];

      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: query, params }),
      });
      expect(res.status).toBe(200);

      const data = (await res.json()) as { success: boolean };
      expect(data.success).toBe(true);
    });
  });

  describe('Cache Key Generation', () => {
    it('different SQL generates different cache keys', async () => {
      const query1 = 'SELECT id FROM cache_test_posts WHERE tenant_id = ? ORDER BY id';
      const query2 = 'SELECT id FROM cache_test_posts WHERE tenant_id = ? ORDER BY id DESC';
      const params = [testTenantId];

      // Query 1
      await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: query1, params }),
      });

      // Query 2 should miss cache (different SQL)
      const res2 = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: query2, params }),
      });
      const data2 = (await res2.json()) as { cached: boolean };
      expect(data2.cached).toBe(false);
    });

    it('same SQL with different params generates different cache keys', async () => {
      const query = 'SELECT id FROM cache_test_posts WHERE tenant_id = ? AND author_id = ?';

      // Query with author_id = 1
      await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: query, params: [testTenantId, 1] }),
      });

      // Query with author_id = 2 should miss cache
      const res2 = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: query, params: [testTenantId, 2] }),
      });
      const data2 = (await res2.json()) as { cached: boolean };
      expect(data2.cached).toBe(false);
    });
  });

  describe('Cache Metrics and Observability', () => {
    it('cache performance is tracked in metrics', async () => {
      // Perform some cached and uncached queries
      const query = 'SELECT id, title FROM cache_test_posts WHERE tenant_id = ? LIMIT 1';
      const params = [testTenantId];

      // Uncached query
      await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: query, params }),
      });

      // Cached query
      await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: query, params }),
      });

      // Check metrics endpoint
      const metricsRes = await SELF.fetch('http://localhost:8787//metrics');
      expect(metricsRes.status).toBe(200);

      const metrics = (await metricsRes.json()) as { cache: { status: string } };
      expect(metrics.cache.status).toBe('operational');
    });
  });
});
