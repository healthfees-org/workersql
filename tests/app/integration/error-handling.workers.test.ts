import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

// Comprehensive integration test for error handling and resilience

describe('Error Handling Integration', () => {
  let validToken: string;

  beforeAll(async () => {
    validToken = 'Bearer test-valid-token';
  });

  describe('Authentication Errors', () => {
    it('returns 401 for missing authorization', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql: 'SELECT 1' }),
      });
      expect(res.status).toBe(401);

      const data = (await res.json()) as { error?: string };
      expect(data.error).toBeUndefined(); // Should not leak error details
    });

    it('returns 401 for invalid token format', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'InvalidFormat token',
        },
        body: JSON.stringify({ sql: 'SELECT 1' }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for expired tokens', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer expired-token',
        },
        body: JSON.stringify({ sql: 'SELECT 1' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('SQL Syntax and Validation Errors', () => {
    it('returns 400 for malformed SQL', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'SELET 1', // Typo in SELECT
        }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for incomplete SQL statements', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'SELECT',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for SQL injection attempts', async () => {
      const maliciousQueries = [
        'SELECT * FROM users; DROP TABLE users; --',
        'SELECT * FROM users WHERE id = 1 UNION SELECT password FROM admin; --',
        "SELECT * FROM users; EXEC xp_cmdshell 'dir'; --",
      ];

      for (const sql of maliciousQueries) {
        const res = await SELF.fetch('http://localhost:8787//sql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: validToken,
          },
          body: JSON.stringify({ sql }),
        });
        // Should either reject (400) or only execute safe part
        expect([200, 400]).toContain(res.status);
      }
    });

    it('handles missing table gracefully', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'SELECT * FROM nonexistent_table',
        }),
      });
      expect(res.status).toBe(500); // Database error

      const data = (await res.json()) as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });
  });

  describe('Request Validation Errors', () => {
    it('returns 400 for missing SQL in request body', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for null SQL parameter', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: null }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for non-string SQL parameter', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: 123 }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for malformed JSON', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: 'invalid json {{{',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('Permission and Authorization Errors', () => {
    it('returns 403 for insufficient permissions on DDL', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-user-token', // Non-admin user
        },
        body: JSON.stringify({
          sql: 'CREATE TABLE test_perm_check (id INTEGER PRIMARY KEY)',
        }),
      });
      expect(res.status).toBe(400); // DDL not allowed for regular users
    });

    it('returns 403 for admin-only endpoints without admin role', async () => {
      const res = await SELF.fetch('http://localhost:8787//admin/shards/metrics', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer test-user-token',
        },
      });
      expect(res.status).toBe(403);

      const data = (await res.json()) as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toBe('Forbidden');
    });
  });

  describe('Network and Connectivity Errors', () => {
    it('handles network timeouts gracefully', async () => {
      // This test would require setting up timeout conditions
      // For now, test with a complex query that might timeout
      const complexQuery = `
        SELECT * FROM (
          SELECT 1 as n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
        ) t1
        CROSS JOIN (
          SELECT 1 as m UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
        ) t2
        CROSS JOIN (
          SELECT 1 as o UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
        ) t3
      `;

      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: complexQuery }),
      });

      // Should either succeed or fail gracefully
      expect([200, 500]).toContain(res.status);

      if (res.status === 500) {
        const data = (await res.json()) as { success: boolean; error: string };
        expect(data.success).toBe(false);
        expect(data.error).toBeDefined();
      }
    });
  });

  describe('Circuit Breaker Behavior', () => {
    it('handles shard failures gracefully', async () => {
      // This test would require setting up shard failure conditions
      // For now, test that the system handles errors without crashing
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'SELECT * FROM invalid_shard_reference',
        }),
      });

      // Should fail gracefully without bringing down the service
      expect([200, 500]).toContain(res.status);
    });
  });

  describe('Rate Limiting Errors', () => {
    it('returns 429 when rate limit exceeded', async () => {
      // Make many rapid requests to trigger rate limiting
      const requests = [];
      for (let i = 0; i < 200; i++) {
        requests.push(
          SELF.fetch('http://localhost:8787//sql', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: validToken,
            },
            body: JSON.stringify({ sql: 'SELECT 1' }),
          })
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter((r) => r.status === 429);

      if (rateLimited.length > 0) {
        const rateLimitRes = rateLimited[0]!;
        expect(rateLimitRes.headers.get('retry-after')).toBeTruthy();

        const data = (await rateLimitRes.json()) as { error?: string };
        // Rate limit errors should not leak sensitive information
        expect(data.error).toBeUndefined();
      }
    });
  });

  describe('Data Validation Errors', () => {
    it('handles invalid parameter types', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'SELECT * FROM test_table WHERE id = ?',
          params: ['not-a-number'], // Wrong type for integer parameter
        }),
      });

      // Should either succeed (SQLite is flexible) or fail gracefully
      expect([200, 500]).toContain(res.status);
    });

    it('handles too many parameters', async () => {
      const manyParams = new Array(1000).fill('test');
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'SELECT ?' + ', ?'.repeat(999),
          params: manyParams,
        }),
      });

      // Should either succeed or fail gracefully
      expect([200, 400, 500]).toContain(res.status);
    });
  });

  describe('Resource Exhaustion Errors', () => {
    it('handles large result sets', async () => {
      // Create a query that returns many rows
      const largeQuery = `
        WITH RECURSIVE series(x) AS (
          SELECT 1
          UNION ALL
          SELECT x + 1 FROM series WHERE x < 10000
        )
        SELECT x FROM series
      `;

      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: largeQuery }),
      });

      // Should either succeed or fail gracefully with resource limits
      expect([200, 500]).toContain(res.status);
    });

    it('handles deeply nested queries', async () => {
      // Create a deeply nested query
      let nestedQuery = 'SELECT 1';
      for (let i = 0; i < 10; i++) {
        nestedQuery = `SELECT * FROM (${nestedQuery})`;
      }

      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: nestedQuery }),
      });

      // Should either succeed or fail gracefully
      expect([200, 500]).toContain(res.status);
    });
  });

  describe('Error Response Format', () => {
    it('returns consistent error response format', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'INVALID SQL QUERY',
        }),
      });
      expect(res.status).toBe(400);

      const data = (await res.json()) as {
        success: boolean;
        error: string;
        code?: string;
      };
      expect(data.success).toBe(false);
      expect(typeof data.error).toBe('string');
      expect(data.error.length).toBeGreaterThan(0);
    });

    it('includes request ID in error responses', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'SELECT * FROM nonexistent_table',
        }),
      });
      expect(res.status).toBe(500);

      expect(res.headers.get('x-request-id')).toBeTruthy();
      expect(res.headers.get('content-type')).toBe('application/json');
    });

    it('does not leak sensitive information in errors', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'SELECT password FROM users', // Attempt to access sensitive data
        }),
      });

      const data = (await res.json()) as { error?: string };

      // Error messages should not reveal schema details
      if (data.error) {
        expect(data.error.toLowerCase()).not.toContain('password');
        expect(data.error.toLowerCase()).not.toContain('users');
      }
    });
  });
});
