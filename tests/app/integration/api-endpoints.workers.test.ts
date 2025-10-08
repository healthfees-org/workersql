import { describe, it, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';

// Comprehensive integration test for API endpoints
// Tests all HTTP endpoints in the Workers runtime

describe('API Endpoints Integration', () => {
  let validToken: string;
  let adminToken: string;

  beforeAll(async () => {
    // Generate test tokens for different permission levels
    // In a real scenario, these would be JWTs signed with the configured secret
    validToken = 'Bearer test-user-token';
    adminToken = 'Bearer test-admin-token';
  });

  describe('Health Check Endpoint', () => {
    it('GET /health returns healthy status', async () => {
      const res = await SELF.fetch('http://localhost:8787//health');
      expect(res.status).toBe(200);

      const data = (await res.json()) as {
        status: string;
        version: string;
        timestamp: string;
        uptime: number;
      };
      expect(data).toMatchObject({
        status: 'healthy',
        version: expect.any(String),
        timestamp: expect.any(String),
      });
      expect(data.uptime).toBeDefined();
    });

    it('includes security headers', async () => {
      const res = await SELF.fetch('http://localhost:8787//health');
      expect(res.headers.get('content-security-policy')).toBeTruthy();
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
    });
  });

  describe('Metrics Endpoint', () => {
    it('GET /metrics returns operational metrics', async () => {
      const res = await SELF.fetch('http://localhost:8787//metrics');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toMatchObject({
        timestamp: expect.any(String),
        connections: {
          active: expect.any(Number),
          inTransaction: expect.any(Number),
        },
        cache: {
          status: 'operational',
        },
        shards: {
          status: 'operational',
        },
      });
    });
  });

  describe('Auth Me Endpoint', () => {
    it('GET /auth/me without auth returns unauthenticated', async () => {
      const res = await SELF.fetch('http://localhost:8787//auth/me');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual({
        authenticated: false,
      });
    });

    it('GET /auth/me with valid token returns user context', async () => {
      const res = await SELF.fetch('http://localhost:8787//auth/me', {
        headers: {
          Authorization: validToken,
        },
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toMatchObject({
        authenticated: true,
        tenantId: expect.any(String),
        permissions: expect.any(Array),
      });
    });

    it('GET /auth/me with admin token returns admin context', async () => {
      const res = await SELF.fetch('http://localhost:8787//auth/me', {
        headers: {
          Authorization: adminToken,
        },
      });
      expect(res.status).toBe(200);

      const data = (await res.json()) as {
        authenticated: boolean;
        tenantId?: string;
        userId?: string;
        permissions: string[];
      };
      expect(data.authenticated).toBe(true);
      expect(data.permissions).toContain('admin');
    });
  });

  describe('CORS Handling', () => {
    it('OPTIONS request returns proper CORS headers', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'OPTIONS',
      });
      expect(res.status).toBe(204);

      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-methods')).toContain('POST');
      expect(res.headers.get('access-control-allow-headers')).toContain('Content-Type');
    });
  });

  describe('SQL Query Endpoint', () => {
    const testTenantId = 'test-tenant-123';

    it('POST /sql with invalid auth returns 401', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sql: 'SELECT 1',
        }),
      });
      expect(res.status).toBe(401);
    });

    it('POST /sql with valid SELECT returns results', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'SELECT 1 as test_value',
        }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toMatchObject({
        success: true,
        data: expect.any(Array),
        cached: expect.any(Boolean),
        executionTime: expect.any(Number),
      });
    });

    it('POST /sql with INSERT returns affected rows', async () => {
      // First create a test table
      await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: adminToken,
        },
        body: JSON.stringify({
          sql: 'CREATE TABLE IF NOT EXISTS test_users (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)',
        }),
      });

      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'INSERT INTO test_users (name, tenant_id) VALUES (?, ?)',
          params: ['Test User', testTenantId],
        }),
      });
      expect(res.status).toBe(200);

      const data = (await res.json()) as {
        success: boolean;
        data: { rowsAffected: number };
        cached: boolean;
        executionTime: number;
      };
      expect(data).toMatchObject({
        success: true,
        data: expect.any(Object),
        cached: false,
        executionTime: expect.any(Number),
      });
      expect(data.data.rowsAffected).toBe(1);
    });

    it('POST /sql with UPDATE returns affected rows', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'UPDATE test_users SET name = ? WHERE tenant_id = ?',
          params: ['Updated User', testTenantId],
        }),
      });
      expect(res.status).toBe(200);

      const data = (await res.json()) as {
        success: boolean;
        data: { rowsAffected: number };
        cached: boolean;
        executionTime: number;
      };
      expect(data.success).toBe(true);
      expect(data.data.rowsAffected).toBeGreaterThanOrEqual(0);
    });

    it('POST /sql with DELETE returns affected rows', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'DELETE FROM test_users WHERE tenant_id = ?',
          params: [testTenantId],
        }),
      });
      expect(res.status).toBe(200);

      const data = (await res.json()) as {
        success: boolean;
        data: { rowsAffected: number };
        cached: boolean;
        executionTime: number;
      };
      expect(data.success).toBe(true);
      expect(data.data.rowsAffected).toBeGreaterThanOrEqual(0);
    });

    it('POST /sql with invalid SQL returns 400', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'INVALID SQL STATEMENT',
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('Batch SQL Endpoint', () => {
    it('POST /sql/batch with multiple operations succeeds', async () => {
      const batch = [{ sql: 'SELECT 1 as batch_test_1' }, { sql: 'SELECT 2 as batch_test_2' }];

      const res = await SELF.fetch('http://localhost:8787//sql/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ batch }),
      });
      expect(res.status).toBe(200);

      const data = (await res.json()) as {
        success: boolean;
        data: {
          results: Array<{ rowsAffected: number }>;
          totalRowsAffected: number;
        };
      };
      expect(data).toMatchObject({
        success: true,
        data: {
          results: expect.any(Array),
          totalRowsAffected: expect.any(Number),
        },
      });
      expect(data.data.results).toHaveLength(2);
    });

    it('POST /sql/batch with DDL operations requires admin', async () => {
      const batch = [{ sql: 'CREATE TABLE IF NOT EXISTS batch_test (id INTEGER PRIMARY KEY)' }];

      const res = await SELF.fetch('http://localhost:8787//sql/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken, // Non-admin token
        },
        body: JSON.stringify({ batch }),
      });
      expect(res.status).toBe(400); // Should fail due to DDL restriction
    });
  });

  describe('Request Headers and Metadata', () => {
    it('includes X-Request-ID in responses', async () => {
      const res = await SELF.fetch('http://localhost:8787//health');
      expect(res.headers.get('x-request-id')).toBeTruthy();
    });

    it('includes proper content-type for JSON responses', async () => {
      const res = await SELF.fetch('http://localhost:8787//health');
      expect(res.headers.get('content-type')).toBe('application/json');
    });
  });
});
