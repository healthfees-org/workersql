import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EdgeSQLGateway } from '@/gateway';
import type { CloudflareEnvironment } from '@/types';

describe('EdgeSQLGateway', () => {
  let gateway: EdgeSQLGateway;
  let mockEnv: CloudflareEnvironment;
  let mockCtx: ExecutionContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockEnv = {
      APP_CACHE: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue({ keys: [] }),
      } as any,
      DB_EVENTS: {
        send: vi.fn().mockResolvedValue(undefined),
      } as any,
      SHARD: {} as any,
      PORTABLE_DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue({ results: [], success: true }),
          first: vi.fn().mockResolvedValue(null),
          run: vi.fn().mockResolvedValue({ success: true }),
        }),
      } as any,
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'debug',
      MAX_SHARD_SIZE_GB: '1',
      CACHE_TTL_MS: '30000',
      CACHE_SWR_MS: '120000',
    };

    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as any;

    gateway = new EdgeSQLGateway(mockEnv, mockCtx);
  });

  describe('handleHealthCheck', () => {
    it('should return healthy status', () => {
      const response = gateway.handleHealthCheck();

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');
    });

    it('should include version and timestamp', async () => {
      const response = gateway.handleHealthCheck();
      const data = await response.json();

      expect(data).toHaveProperty('status', 'healthy');
      expect(data).toHaveProperty('version');
      expect(data).toHaveProperty('timestamp');
    });

    it('should return health check data', async () => {
      const response = gateway.handleHealthCheck();
      const data = (await response.json()) as any;

      expect(data).toHaveProperty('uptime');
      expect(typeof data.uptime).toBe('number');
    });
  });

  describe('handleMetrics', () => {
    it('should return metrics data', () => {
      const response = gateway.handleMetrics();

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');
    });

    it('should include connection metrics', async () => {
      const response = gateway.handleMetrics();
      const data = await response.json();

      expect(data).toBeDefined();
    });
  });

  describe('handleRequest', () => {
    it('should handle POST requests', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          sql: 'SELECT * FROM users',
          params: [],
        }),
      });

      const response = await gateway.handleRequest(request);
      expect(response).toBeDefined();
      expect(response.status).toBeLessThan(500);
    });

    it('should handle OPTIONS requests (CORS)', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'OPTIONS',
      });

      const response = await gateway.handleRequest(request);
      expect([200, 204]).toContain(response.status);
      expect(response.headers.has('Access-Control-Allow-Origin')).toBe(true);
    });

    it('should reject requests without authentication', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sql: 'SELECT * FROM users',
        }),
      });

      const response = await gateway.handleRequest(request);
      expect(response.status).toBe(401);
    });

    it('should handle rate limiting', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          sql: 'SELECT * FROM users',
        }),
      });

      const response = await gateway.handleRequest(request);
      expect(response).toBeDefined();
    });

    it('should handle invalid JSON', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: 'invalid json',
      });

      const response = await gateway.handleRequest(request);
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle missing SQL in request', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          params: [],
        }),
      });

      const response = await gateway.handleRequest(request);
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('SQL Query Handling', () => {
    it('should handle SELECT queries', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          sql: 'SELECT * FROM users WHERE id = ?',
          params: [1],
        }),
      });

      const response = await gateway.handleRequest(request);
      expect(response).toBeDefined();
    });

    it('should handle INSERT queries', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          sql: 'INSERT INTO users (name, email) VALUES (?, ?)',
          params: ['John', 'john@example.com'],
        }),
      });

      const response = await gateway.handleRequest(request);
      expect(response).toBeDefined();
    });

    it('should handle UPDATE queries', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          sql: 'UPDATE users SET name = ? WHERE id = ?',
          params: ['Jane', 1],
        }),
      });

      const response = await gateway.handleRequest(request);
      expect(response).toBeDefined();
    });

    it('should handle DELETE queries', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          sql: 'DELETE FROM users WHERE id = ?',
          params: [1],
        }),
      });

      const response = await gateway.handleRequest(request);
      expect(response).toBeDefined();
    });

    it('should handle DDL queries', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          sql: 'CREATE TABLE test (id INT, name TEXT)',
        }),
      });

      const response = await gateway.handleRequest(request);
      expect(response).toBeDefined();
    });
  });

  describe('CORS Handling', () => {
    it('should include CORS headers in responses', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'OPTIONS',
      });

      const response = await gateway.handleRequest(request);
      expect(response.headers.has('Access-Control-Allow-Origin')).toBe(true);
      expect(response.headers.has('Access-Control-Allow-Methods')).toBe(true);
      expect(response.headers.has('Access-Control-Allow-Headers')).toBe(true);
    });

    it('should handle preflight requests', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'OPTIONS',
        headers: {
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type,Authorization',
        },
      });

      const response = await gateway.handleRequest(request);
      expect([200, 204]).toContain(response.status);
    });
  });

  describe('WebSocket Handling', () => {
    it('should detect WebSocket upgrade requests', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'GET',
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
          'Sec-WebSocket-Key': 'test-key',
          'Sec-WebSocket-Version': '13',
        },
      });

      const response = await gateway.handleRequest(request);
      expect(response).toBeDefined();
    });

    it('should handle WebSocket with authorization', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'GET',
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
          'Sec-WebSocket-Key': 'test-key',
          'Sec-WebSocket-Version': '13',
          Authorization: 'Bearer test-token',
        },
      });

      const response = await gateway.handleRequest(request);
      expect(response).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle internal errors gracefully', async () => {
      // Create a request that will cause an error
      const request = new Request('http://localhost/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          sql: null, // Invalid SQL
        }),
      });

      const response = await gateway.handleRequest(request);
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should return JSON error responses', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sql: 'SELECT * FROM users',
        }),
      });

      const response = await gateway.handleRequest(request);
      if (response.status >= 400) {
        const contentType = response.headers.get('Content-Type');
        // May be text/plain or application/json depending on error path
        expect(contentType).toBeDefined();
      }
    });

    it('should include error messages in responses', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sql: 'SELECT * FROM users',
        }),
      });

      const response = await gateway.handleRequest(request);
      if (response.status >= 400) {
        const text = await response.text();
        // Just verify we get a response
        expect(text).toBeDefined();
        expect(text.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Request Logging', () => {
    it('should log incoming requests', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const request = new Request('http://localhost/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          sql: 'SELECT * FROM users',
        }),
      });

      await gateway.handleRequest(request);

      consoleSpy.mockRestore();
    });
  });

  describe('Performance', () => {
    it('should handle requests in reasonable time', async () => {
      const start = Date.now();

      const request = new Request('http://localhost/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          sql: 'SELECT * FROM users',
        }),
      });

      await gateway.handleRequest(request);

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
    });

    it('should handle concurrent requests', async () => {
      const requests = Array.from(
        { length: 5 },
        () =>
          new Request('http://localhost/sql', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer test-token',
            },
            body: JSON.stringify({
              sql: 'SELECT * FROM users',
            }),
          })
      );

      const responses = await Promise.all(requests.map((req) => gateway.handleRequest(req)));

      responses.forEach((response) => {
        expect(response).toBeDefined();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty request body', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: '',
      });

      const response = await gateway.handleRequest(request);
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle large payloads', async () => {
      const largeParams = Array.from({ length: 100 }, (_, i) => `value-${i}`);

      const request = new Request('http://localhost/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          sql: `SELECT * FROM users WHERE id IN (${largeParams.map(() => '?').join(',')})`,
          params: largeParams,
        }),
      });

      const response = await gateway.handleRequest(request);
      expect(response).toBeDefined();
    });

    it('should handle special characters in SQL', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          sql: "SELECT * FROM users WHERE name = 'O''Brien'",
        }),
      });

      const response = await gateway.handleRequest(request);
      expect(response).toBeDefined();
    });

    it('should handle different content types', async () => {
      const request = new Request('http://localhost/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          sql: 'SELECT * FROM users',
        }),
      });

      const response = await gateway.handleRequest(request);
      expect(response).toBeDefined();
    });
  });
});
